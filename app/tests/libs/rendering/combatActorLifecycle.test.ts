import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Assets, BufferImageSource, Container, Graphics, Texture } from "pixi.js";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { createCombatActors } from "@/libs/rendering/scenes/combatActors";
import { makeBattleUser, makeCompleteBattle } from "../combat/helpers/battleScenario";

const cleanups: (() => void)[] = [];
let sequence = 0;
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(Assets, "load").mockImplementation(async () => new Texture({ source: new BufferImageSource({ resource: new Uint8Array(16 * 16 * 4), width: 16, height: 16 }) }));
  vi.spyOn(Assets, "unload").mockResolvedValue(undefined);
});
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });
const setup = async () => {
  const owned = new Set<() => void>(), stage = new Container();
  const game = { own: (cleanup: () => void) => owned.add(cleanup), disown: (cleanup: () => void) => owned.delete(cleanup), isDisposed: () => false, signal: new AbortController().signal } as unknown as GameRenderer;
  cleanups.push(() => { stage.destroy({ children: true, texture: false, textureSource: false }); for (const cleanup of owned) cleanup(); });
  const user = makeBattleUser("actor", { longitude: 3, latitude: 1, avatar: `https://example.com/actor-${sequence++}.png`, isAi: true, isOriginal: true });
  const battle = makeCompleteBattle({ usersState: [user], usersEffects: [], width: 12, height: 10 }) as unknown as ReturnedBattle;
  const grid = getBattleGrid(40, battle, { x: -20, y: -20 });
  const step = vi.fn(), actors = createCombatActors(game, grid, step);
  stage.addChild(actors.container); actors.sync({ battle }); await actors.ready();
  const root = actors.container.children[0]!;
  return { actors, root, user, battle, owned, step };
};

describe("combat actor reconciliation", () => {
  it("interpolates position across snapshots without recreating the actor or mutating pools", async () => {
    const { actors, root, user, battle } = await setup();
    const pools = [user.curHealth, user.maxHealth];
    user.longitude = 4; actors.sync({ battle });
    const before = { x: root.x, y: root.y };
    expect(actors.animate({ now: 1000, delta: 1 / 60, reducedMotion: false }, user.userId, undefined)).toBe(true);
    expect(actors.container.children[0]).toBe(root);
    expect({ x: root.x, y: root.y }).not.toEqual(before);
    expect([user.curHealth, user.maxHealth]).toEqual(pools);
    actors.animate({ now: 1017, delta: 1 / 60, reducedMotion: true }, user.userId, undefined);
    expect(actors.animate({ now: 1034, delta: 0, reducedMotion: true }, user.userId, undefined)).toBe(false);
  });
  it("keeps unchanged aggro geometry and shows an empty ring for zero threat", async () => {
    const { actors, root, user, battle } = await setup();
    const aggro = new Map([[user.userId, { enmity: 0, ratio: 0, isHighest: false }]]);
    actors.sync({ battle, aggro });
    const halo = root.children.at(-1) as Graphics;
    expect(halo.visible).toBe(true);
    const instructions = [...halo.context.instructions];
    actors.sync({ battle, aggro });
    expect(halo.context.instructions).toEqual(instructions);
    actors.sync({ battle }); expect(halo.visible).toBe(false);
  });
  it("removes absent actors and their asset scopes immediately", async () => {
    const { actors, root, battle, owned } = await setup();
    const before = owned.size;
    battle.usersState = []; actors.sync({ battle });
    expect(root.destroyed).toBe(true); expect(actors.container.children).toHaveLength(0);
    expect(owned.size).toBeLessThan(before);
  });
});
