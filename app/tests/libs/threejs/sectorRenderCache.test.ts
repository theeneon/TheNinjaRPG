import { afterEach, describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Sprite, SpriteMaterial } from "three";
import { defineHex } from "@/libs/hexgrid";
import {
  createSectorRenderCache,
  sectorRenderKey,
  type SectorRenderEntry,
} from "@/libs/threejs/sectorRenderCache";

const caches: ReturnType<typeof createSectorRenderCache>[] = [];
const createCache = (capacity = 9, retentionMs?: number) => {
  const cache = createSectorRenderCache(capacity, retentionMs);
  caches.push(cache);
  return cache;
};
afterEach(() => {
  for (const cache of caches.splice(0)) cache.clear();
});

const createRender = (renderKey = "sector-content") => {
  const grid = new Grid(defineHex(), rectangle({ width: 2, height: 2 }));
  const interaction = new Group();
  const tile = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial());
  tile.userData = { type: "tile", tile: grid.getHex({ col: 0, row: 0 }), sector: 1, highlight: true };
  interaction.add(tile);
  const assets = new Group();
  const wrapper = new Group();
  wrapper.add(interaction, assets);
  const render: SectorRenderEntry = {
    wrapper, grid, interaction, assets, animatedMaterials: [], renderKey,
  };
  return { render, tile };
};

describe("sector render reuse", () => {
  it("keys every static render input but ignores a sector's position in the window", () => {
    type Entry = Parameters<typeof sectorRenderKey>[0];
    const entry = {
      sector: 177,
      dx: 0,
      dy: 0,
      globalTileType: 1,
      villageType: null,
      structures: [],
      map: { width: 26, height: 26, metadata: { importedAt: "published-v1", sourceHash: "map-v1" } },
    } as unknown as Entry;
    const context = { width: 800, lightLayout: false, userId: "player-a", libraryVersion: "library-v1", additions: [] };
    const key = sectorRenderKey(entry, context);
    expect(sectorRenderKey({ ...entry, dx: 1, dy: -1 }, context)).toBe(key);
    for (const change of [
      { width: 400 }, { lightLayout: true }, { userId: "player-b" }, { libraryVersion: "library-v2" },
    ]) {
      expect(sectorRenderKey(entry, { ...context, ...change })).not.toBe(key);
    }
    for (const change of [
      { sector: 178 }, { globalTileType: 2 }, { villageType: "VILLAGE" },
      { map: { ...entry.map, width: 27 } },
      { map: { ...entry.map, metadata: { ...entry.map.metadata, sourceHash: "map-v2" } } },
      { structures: [{ id: "new-building" }] },
    ]) {
      expect(sectorRenderKey({ ...entry, ...change } as Entry, context)).not.toBe(key);
    }
    expect(sectorRenderKey(entry, { ...context, additions: [{ id: "private-entrance" }] as Entry["structures"] })).not.toBe(key);
  });

  it("ignores regenerated structure timestamps while invalidating changed entrance art", () => {
    type Entry = Parameters<typeof sectorRenderKey>[0];
    const structure = { id: "dungeon-1", name: "Dungeon", image: "first.webp", longitude: 2, latitude: 3, hasPage: 1, level: 1, lastUpgradedAt: new Date(0) } as Entry["structures"][number];
    const entry = { sector: 1, globalTileType: 1, villageType: null, structures: [], map: { width: 26, height: 26, metadata: { importedAt: "v1" } } } as unknown as Entry;
    const context = { width: 800, lightLayout: false, userId: "player-a", libraryVersion: "v1", additions: [structure] };
    const key = sectorRenderKey(entry, context);
    expect(sectorRenderKey(entry, { ...context, additions: [{ ...structure, lastUpgradedAt: new Date(1000) }] })).toBe(key);
    expect(sectorRenderKey(entry, { ...context, additions: [{ ...structure, image: "second.webp" }] })).not.toBe(key);
    expect(sectorRenderKey(entry, { ...context, additions: [{ ...structure, name: "Renamed dungeon" }] })).not.toBe(key);
  });

  it("checks out a sector exclusively with fresh hover state and the current sector stamp", () => {
    const cache = createCache();
    const { render, tile } = createRender();
    const scene = new Group();
    scene.add(render.wrapper);
    cache.release(render);
    expect(render.wrapper.parent).toBeNull();
    expect(scene.children).toHaveLength(0);
    expect(cache.take(render.renderKey, 42)).toBe(render);
    expect(cache.take(render.renderKey, 42)).toBeUndefined();
    expect(tile.userData.highlight).toBe(false);
    expect(tile.material.visible).toBe(false);
    expect(tile.userData.sector).toBe(42);
    expect(tile.userData.tile).toBe(render.grid.getHex({ col: 0, row: 0 }));
  });

  it("releases GPU buffers while preserving reusable CPU geometry and shared materials", () => {
    const cache = createCache();
    const { render, tile } = createRender();
    const positions = tile.geometry.getAttribute("position").array;
    let disposedGeometry = 0;
    let disposedPrivateMaterial = 0;
    let disposedSharedMaterial = 0;
    tile.geometry.addEventListener("dispose", () => disposedGeometry++);
    tile.material.addEventListener("dispose", () => disposedPrivateMaterial++);
    const sharedMaterial = new SpriteMaterial();
    sharedMaterial.userData.shared = true;
    sharedMaterial.addEventListener("dispose", () => disposedSharedMaterial++);
    render.assets.add(new Sprite(sharedMaterial));
    cache.release(render);
    const reused = cache.take(render.renderKey, 1);
    expect(reused).toBe(render);
    expect(disposedGeometry).toBe(1);
    expect(disposedPrivateMaterial).toBe(1);
    expect(disposedSharedMaterial).toBe(0);
    expect(tile.geometry.getAttribute("position").array).toBe(positions);
    expect(positions.length).toBeGreaterThan(0);
  });

  it("removes live quest entrances and restores the scenery they hid before retention", () => {
    const cache = createCache();
    const { render } = createRender();
    const decoration = new Sprite(new SpriteMaterial());
    decoration.userData = { type: "decoration", mapX: 0, mapY: 0, mapLocationBaseVisible: true };
    decoration.visible = false;
    const entrance = new Sprite(new SpriteMaterial());
    entrance.userData.type = "questStructure";
    let disposedEntrance = 0;
    entrance.material.addEventListener("dispose", () => disposedEntrance++);
    render.assets.add(decoration, entrance);
    cache.release(render);
    const reused = cache.take(render.renderKey, 1)!;
    expect(reused.assets.children).toEqual([decoration]);
    expect(decoration.visible).toBe(true);
    expect(decoration.userData.mapLocationBaseVisible).toBeUndefined();
    expect(disposedEntrance).toBe(1);
  });

  it("misses changed content and evicts the oldest idle sector at the window bound", () => {
    const cache = createCache(2);
    const first = createRender("first").render;
    const second = createRender("second").render;
    const third = createRender("third").render;
    cache.release(first);
    cache.release(second);
    expect(cache.take("changed-content", 1)).toBeUndefined();
    cache.release(third);
    expect(cache.take("first", 1)).toBeUndefined();
    expect(cache.take("second", 2)).toBe(second);
    expect(cache.take("third", 3)).toBe(third);
  });

  it("expires idle CPU content", async () => {
    const cache = createCache(9, 0);
    const { render } = createRender();
    cache.release(render);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cache.take(render.renderKey, 1)).toBeUndefined();
  });
});
