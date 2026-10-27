import type { Grid } from "honeycomb-grid";
import { Container, Graphics, Sprite } from "pixi.js";
import {
  IMG_AVATAR_DEFAULT,
  IMG_BATTLEFIELD_STAR,
  IMG_BATTLEFIELD_TOMBSTONE,
  IMG_SECTOR_USER_MARKER,
  IMG_SECTOR_USER_SPRITE_MASK,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { stillInBattle } from "@/libs/combat/actions";
import type { AggroDisplay } from "@/libs/combat/aggroDisplay";
import type { ReturnedBattle, ReturnedUserState } from "@/libs/combat/types";
import {
  getClan,
  getEffectiveCurPool,
  getFacingDirection,
  getVillage,
} from "@/libs/combat/util";
import { PathCalculator, type TerrainHex } from "@/libs/hexgrid";
import { createCombatMaxPoolCache } from "@/libs/rendering/combatMaxPools";
import { createSoftShadowTexture } from "@/libs/rendering/primitives/shadow";
import { createWorldSprites } from "@/libs/rendering/primitives/sprites";
import { createStatusMeter } from "@/libs/rendering/primitives/statusMeter";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import { createRenderScope } from "@/libs/rendering/scope";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { isObjectChainVisible } from "@/libs/rendering/visibility";

/** Scene-owned fighters keep art, interpolation and display values outside battle state. */
export const createCombatActors = (
  game: GameRenderer,
  grid: Grid<TerrainHex>,
  onStep: () => void,
) => {
  const container = new Container(),
    records = new Map<string, Fighter>();
  const pending = new Set<Promise<unknown>>();
  const getMaxPools = createCombatMaxPoolCache(),
    paths = new PathCalculator(grid);
  let snapshot: CombatActorSnapshot | null = null;
  let needsSort = true,
    expiresAt = Number.POSITIVE_INFINITY,
    calculatedAt = 0;
  const shadow = createSoftShadowTexture();
  game.own(() => shadow.destroy(true));
  const sync = (next: CombatActorSnapshot) => {
    snapshot = next;
    const wanted = new Set(next.battle.usersState.map((user) => user.userId));
    for (const [id, record] of records)
      if (!wanted.has(id)) {
        record.scope.dispose();
        records.delete(id);
        needsSort = true;
      }
    for (const source of next.battle.usersState) {
      // The authenticated player's own portrait may be redacted in a public battle snapshot.
      const user =
        source.userId === next.viewer?.userId
          ? {
              ...source,
              avatar: next.viewer.avatar,
              avatarLight: next.viewer.avatarLight,
              username: next.viewer.username,
            }
          : source;
      const tile = grid.getHex({ col: user.longitude, row: user.latitude });
      if (!tile) continue;
      let record = records.get(user.userId);
      const parts = combatActorParts(user, tile, next.battle, next.playerId);
      const signature = JSON.stringify(parts);
      if (!record || record.signature !== signature) {
        if (!record && (user.curHealth <= 0 || user.fledBattle)) continue;
        const previous = record;
        const previousPosition = previous
          ? { x: previous.root.x, y: previous.root.y }
          : null;
        previous?.scope.dispose();
        const scope = createRenderScope(game),
          root = new Container(),
          artRoot = new Container();
        const shadowSprite = new Sprite(shadow);
        shadowSprite.anchor.set(0.5);
        shadowSprite.width = tile.width * 0.8;
        shadowSprite.height = tile.height * 0.5;
        shadowSprite.scale.y *= -1;
        shadowSprite.position.set(tile.width / 2, tile.height * 0.3);
        root.addChild(shadowSprite, artRoot);
        const noMarker = user.isAi && user.isOriginal;
        const offset = noMarker ? tile.height / 8 : 0;
        const meter = (color: number, index: number) =>
          createStatusMeter({
            width: tile.width / 2,
            height: tile.height / 10,
            color,
            y:
              tile.height +
              tile.width / 3 -
              ((offset + index) * (tile.height * 0.3 - 2)) / 3,
          });
        const hp = meter(0xb22222, 0);
        const sp = "curStamina" in user ? meter(0x008000, 1) : null;
        const cp = "curChakra" in user ? meter(0x0000ff, 2) : null;
        root.addChild(hp.container);
        if (sp) root.addChild(sp.container);
        if (cp) root.addChild(cp.container);
        const halo = new Graphics();
        root.addChild(halo);
        root.label = user.userId;
        container.addChild(root);
        scope.own(() => {
          if (!root.destroyed)
            root.destroy({ children: true, texture: false, textureSource: false });
        });
        record = {
          scope,
          root,
          artRoot,
          art: null,
          signature,
          user,
          tile: previous?.tile ?? tile,
          target: previous?.target ?? tile,
          path: previous?.path ?? [],
          pathIndex: previous?.pathIndex ?? 0,
          hp,
          sp,
          cp,
          halo,
          haloRatio: Number.NaN,
          shadow: shadowSprite,
          alive: true,
        };
        root.position.set(
          previousPosition?.x ?? -tile.center.x,
          previousPosition?.y ?? -tile.center.y,
        );
        records.set(user.userId, record);
        needsSort = true;
        const current = record;
        const loading = createWorldSprites(scope, parts).then(
          (art) => {
            if (!scope.isDisposed()) {
              current.art = art;
              artRoot.addChild(art.container);
              updateVisual(current);
            }
          },
          (error) => {
            if (!scope.isDisposed()) console.warn("Combat fighter unavailable", error);
          },
        );
        pending.add(loading);
        void loading.finally(() => pending.delete(loading));
      }
      record.user = user;
      if (record.target !== tile) {
        record.target = tile;
        const path = paths.getShortestPath(record.tile, tile) ?? [];
        record.path = path[0] === record.tile ? path.slice(1) : path;
        record.pathIndex = 0;
      }
      updateVisual(record);
    }
    scheduleExpiry();
  };
  const scheduleExpiry = () => {
    calculatedAt = Date.now();
    expiresAt = Number.POSITIVE_INFINITY;
    for (const effect of snapshot?.battle.usersEffects ?? []) {
      if (effect.timedBuffExpiresAt && effect.timedBuffExpiresAt > calculatedAt)
        expiresAt = Math.min(expiresAt, effect.timedBuffExpiresAt);
    }
  };
  const updateVisual = (record: Fighter) => {
    if (!snapshot) return;
    const { user, target } = record;
    const alive = stillInBattle(user, snapshot.battle.usersEffects);
    record.alive = alive;
    record.shadow.visible = alive;
    for (const entry of record.art?.entries ?? []) {
      entry.sprite.visible =
        entry.description.kind === "tombstone" ? !alive && user.isOriginal : alive;
      if (entry.description.kind === "aiAvatar") {
        const facing = getFacingDirection(
          user,
          snapshot.battle.usersState,
          user.avatarFacing ?? "left",
          snapshot.battle.usersEffects,
        );
        entry.sprite.scale.x =
          Math.abs(entry.sprite.scale.x) *
          (facing !== (user.avatarFacing ?? "left") ? -1 : 1);
      }
    }
    const maxima = getMaxPools(user, snapshot.battle, snapshot.battle.usersEffects);
    record.hp.set(
      getEffectiveCurPool(user, snapshot.battle.usersEffects, "Health") / maxima.health,
    );
    if (record.sp && maxima.stamina !== undefined)
      record.sp.set(
        getEffectiveCurPool(user, snapshot.battle.usersEffects, "Stamina") /
          maxima.stamina,
      );
    if (record.cp && maxima.chakra !== undefined)
      record.cp.set(
        getEffectiveCurPool(user, snapshot.battle.usersEffects, "Chakra") /
          maxima.chakra,
      );
    const ratio = alive ? snapshot.aggro?.get(user.userId)?.ratio : undefined;
    record.halo.visible = ratio !== undefined;
    if (ratio !== undefined && ratio !== record.haloRatio) {
      record.haloRatio = ratio;
      const size = target.height * (user.isAi && user.isOriginal ? 1.75 : 1.08);
      record.halo
        .clear()
        .circle(
          target.width / 2,
          target.height * (user.isAi && user.isOriginal ? 0.9 : 1),
          size * 0.4775,
        )
        .stroke({ color: 0x252b26, alpha: 0.65, width: size * 0.045 });
      if (ratio > 0)
        record.halo
          .arc(
            target.width / 2,
            target.height * (user.isAi && user.isOriginal ? 0.9 : 1),
            size * 0.4775,
            Math.PI / 2,
            Math.PI / 2 - Math.PI * 2 * Math.max(0, Math.min(1, ratio)),
            true,
          )
          .stroke({ color: 0xfbbf24, width: size * 0.045 });
    }
  };
  const animate = (
    frame: GameFrame,
    selectedId: string,
    hoveredId: string | undefined,
  ) => {
    if (!snapshot) return false;
    const now = Date.now();
    if (now >= expiresAt || now < calculatedAt) {
      for (const record of records.values()) updateVisual(record);
      scheduleExpiry();
    }
    let moving = false;
    for (const record of records.values()) {
      const { user, root, target } = record;
      const waypoint = record.path[record.pathIndex] ?? target;
      const tx = -waypoint.center.x,
        ty = -waypoint.center.y;
      const distance = Math.hypot(tx - root.x, ty - root.y);
      const segment = Math.hypot(
        waypoint.center.x - record.tile.center.x,
        waypoint.center.y - record.tile.center.y,
      );
      const progress = segment > 0 ? 1 - distance / segment : 1;
      const ease = Math.max(
        0.35,
        Math.sin(Math.PI * Math.max(0, Math.min(1, progress))),
      );
      const step = frame.reducedMotion
        ? distance
        : (record.tile.width / 50) * 5 * frame.delta * 60 * ease;
      if (distance <= step || distance < 0.01) {
        root.position.set(tx, ty);
        if (record.tile !== waypoint) {
          record.tile = waypoint;
          needsSort = true;
          onStep();
        }
        if (record.pathIndex < record.path.length) record.pathIndex++;
      } else {
        root.x += ((tx - root.x) / distance) * step;
        root.y += ((ty - root.y) / distance) * step;
      }
      moving ||= Math.hypot(root.x + target.center.x, root.y + target.center.y) > 0.01;
      const visible =
        record.alive && (user.userId === selectedId || user.userId === hoveredId);
      record.hp.container.visible = visible;
      if (record.sp) record.sp.container.visible = visible;
      if (record.cp) record.cp.container.visible = visible;
    }
    if (needsSort) {
      container.children.sort((a, b) => b.y - a.y);
      needsSort = false;
    }
    return moving;
  };
  const hit = (x: number, y: number) => {
    for (let index = container.children.length - 1; index >= 0; index--) {
      const root = container.children[index];
      const record = root ? records.get(root.label) : undefined;
      if (!record) continue;
      for (const entry of record.art?.entries ?? []) {
        if (!isObjectChainVisible(entry.sprite)) continue;
        const bounds = entry.sprite.getBounds();
        if (
          x >= bounds.minX &&
          x <= bounds.maxX &&
          y >= bounds.minY &&
          y <= bounds.maxY
        )
          return { userId: record.user.userId, tile: record.target };
      }
    }
    return null;
  };
  return {
    container,
    sync,
    animate,
    hit,
    ready: () => Promise.all([...pending]),
    snap: () => {
      for (const record of records.values()) {
        record.tile = record.target;
        record.path = [];
        record.pathIndex = 0;
        record.root.position.set(-record.target.center.x, -record.target.center.y);
      }
      needsSort = true;
    },
    count: () => records.size,
    position: (id: string) => records.get(id)?.root.position,
  };
};

export const combatActorParts = (
  user: ReturnedUserState,
  tile: TerrainHex,
  battle: ReturnedBattle,
  playerId: string | undefined,
) => {
  const h = tile.height,
    w = tile.width;
  const part = (
    kind: string,
    image: string,
    size: number,
    y: number,
    extra: Partial<WorldSpriteDescription> = {},
  ): WorldSpriteDescription => ({
    id: kind,
    kind,
    image,
    size,
    x: w / 2,
    y,
    groundY: 0,
    ...extra,
  });
  const parts: WorldSpriteDescription[] = [];
  if (user.isAi && user.isOriginal) {
    parts.push(part("aiAvatar", user.avatar || IMG_AVATAR_DEFAULT, h * 1.6, h * 0.9));
    if (user.isSummon && user.controllerId === playerId)
      parts.push(part("star", IMG_BATTLEFIELD_STAR, h / 2.5, h * 0.2));
  } else {
    const village = getVillage(battle, user.villageId);
    parts.push(
      part("marker", IMG_SECTOR_USER_MARKER, h * 1.2, h * 0.9, {
        width: h,
        mask: IMG_SECTOR_USER_MARKER,
        tint: village
          ? Number.parseInt(village.hexColor.replace("#", ""), 16)
          : 0x000000,
      }),
      part("marker", IMG_SECTOR_USER_MARKER, h * 1.1, h * 0.9, {
        width: h * 0.9,
        mask: IMG_SECTOR_USER_MARKER,
      }),
      part("avatar", user.avatar || IMG_AVATAR_DEFAULT, h * 0.8, h, {
        mask: IMG_SECTOR_USER_SPRITE_MASK,
      }),
    );
    const clan = getClan(battle, user.clanId);
    if (clan?.image)
      parts.push(
        part("clan-border", IMG_SECTOR_USER_SPRITE_MASK, h * 0.3 + 2, h * 1.4, {
          x: w * 0.9,
          mask: IMG_SECTOR_USER_SPRITE_MASK,
          tint: 0xffd700,
        }),
        part("clan", clan.image, h * 0.3, h * 1.4, {
          x: w * 0.9,
          mask: IMG_SECTOR_USER_SPRITE_MASK,
        }),
      );
  }
  if ("curStamina" in user && user.isOriginal && !user.isAi)
    parts.push(part("star", IMG_BATTLEFIELD_STAR, h / 2.5, h * 0.4));
  parts.push(part("tombstone", IMG_BATTLEFIELD_TOMBSTONE, h * 0.5, h * 0.6));
  return parts;
};

export type CombatActorSnapshot = {
  battle: ReturnedBattle;
  playerId?: string;
  viewer?: Pick<UserData, "userId" | "avatar" | "avatarLight" | "username">;
  aggro?: AggroDisplay;
};
type Meter = ReturnType<typeof createStatusMeter>;
type Fighter = {
  scope: GameRenderer;
  root: Container;
  artRoot: Container;
  art: Awaited<ReturnType<typeof createWorldSprites>> | null;
  signature: string;
  user: ReturnedUserState;
  tile: TerrainHex;
  target: TerrainHex;
  path: TerrainHex[];
  pathIndex: number;
  hp: Meter;
  sp: Meter | null;
  cp: Meter | null;
  halo: Graphics;
  haloRatio: number;
  shadow: Sprite;
  alive: boolean;
};
