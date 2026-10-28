import alea from "alea";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { BufferImageSource, Mesh, Shader, Texture, UniformGroup } from "pixi.js";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import { createHexTerrain } from "@/libs/rendering/primitives/terrain";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import { hexTerrainAt } from "@/libs/rendering/terrainData";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
import { PathCalculator } from "@/libs/hexgrid";
import { buildWindowNav } from "@/libs/sector-map/navigation";
import { isReachableCoordinate, isWalkableCoordinate } from "@/libs/sector-map/validation";
import { mergeTerrainSpecs } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";

const mapOf = (width: number, height: number): NormalizedSectorMap => ({
  formatVersion: SECTOR_MAP_VERSION, sector: 724, name: "Terrain map", width, height,
  tiles: Array.from({ length: width * height }, (_, index) => {
    const x = index % width, y = Math.floor(index / width);
    const terrain = ["ground", "ocean", "dessert", "ice", "snow"][(x + y) % 5] ?? "ground";
    return { x, y, terrain, walkCost: 1, blocked: false, zone: "wilderness", battleBiome: terrain === "dessert" ? "dessert" : terrain === "ice" ? "ice" : terrain === "snow" ? "snow" : terrain === "ocean" ? "ocean" : "ground" };
  }), objects: [], anchors: [], exits: [], metadata: { importedAt: "2026-01-01T00:00:00Z", source: "tiled" },
});
const prepare = (map: NormalizedSectorMap, light = false) => {
  const random = alea(map.sector + 1);
  const { grid } = prepareSectorGrid(1024, random, 1, [], map, mergeTerrainSpecs([]), null);
  return { grid, data: buildSectorTerrainData(grid, random, light) };
};

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); });
const renderer = (texture: (path: string) => Promise<Texture>) => {
  const controller = new AbortController(), owned = new Set<() => void>();
  let disposed = false;
  const own = vi.fn((cleanup: () => void) => { owned.add(cleanup); });
  const game = {
    assets: { texture }, animation: new UniformGroup({ uTime: { value: 0, type: "f32" } }),
    signal: controller.signal, isDisposed: () => disposed, own,
    dispose: () => { disposed = true; for (const cleanup of owned) cleanup(); owned.clear(); },
  } as unknown as GameRenderer;
  cleanups.push(game.dispose);
  return { game, controller, own };
};

describe("shared hex terrain textures", () => {
  it("orders all sector sides below neighboring faces and recessed outlines below flat land", async () => {
    const { data } = prepare(mapOf(5, 3));
    const { game } = renderer(async () => Texture.WHITE);
    const terrains = await Promise.all([createHexTerrain(game, data), createHexTerrain(game, data)]);
    const meshes = terrains.flatMap((terrain) => terrain.container.children as Mesh[]);
    const sides = meshes.filter((mesh) => [data.ground, data.groundEdges].some((points) => points === mesh.geometry.getBuffer("aPosition").data));
    const faces = meshes.filter((mesh) => mesh.geometry.attributes.aTint);
    expect(Math.max(...sides.map((mesh) => mesh.zIndex))).toBeLessThan(Math.min(...faces.map((mesh) => mesh.zIndex)));
    const recessedEdges = meshes.filter((mesh) => mesh.geometry.getBuffer("aPosition").data === data.edges.get(-0.5));
    const flatFaces = faces.filter((mesh) => data.batches.some((batch) => batch.layer === 0 && batch.positions === mesh.geometry.getBuffer("aPosition").data));
    expect(Math.max(...recessedEdges.map((mesh) => mesh.zIndex))).toBeLessThan(Math.min(...flatFaces.map((mesh) => mesh.zIndex)));
  });

  it("covers buried dirt and recessed outlines with higher tile faces", async () => {
    const { data } = prepare(mapOf(5, 3));
    const { game } = renderer(async () => Texture.WHITE);
    const terrain = await createHexTerrain(game, data);
    const meshes = terrain.container.children as Mesh[];
    const faces = meshes.filter((mesh) => mesh.geometry.attributes.aTint);
    const dirtEdges = meshes.find((mesh) => mesh.geometry.topology === "line-list")!;
    expect(meshes.indexOf(dirtEdges)).toBeLessThan(meshes.indexOf(faces[0]!));
    data.batches.forEach((batch, index) => {
      const outline = meshes.find((mesh) => mesh.geometry.getBuffer("aPosition").data === data.edges.get(batch.layer))!;
      expect(meshes.indexOf(outline)).toBeGreaterThan(meshes.indexOf(faces[index]!));
      const higherFace = data.batches.findIndex((next) => next.layer > batch.layer);
      if (higherFace !== -1) expect(meshes.indexOf(outline)).toBeLessThan(meshes.indexOf(faces[higherFace]!));
    });
  });

  it("keeps terrain geometry, palette and picking when one optional image fails", async () => {
    const { grid, data } = prepare(mapOf(3, 2));
    const failedTexture = data.batches.find((batch) => batch.kind === "image")!.texture;
    const failure = new Error("HTTP 404 for optional terrain image");
    const image = new Texture({ source: new BufferImageSource({ resource: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 }) });
    const { game } = renderer(async (path) => { if (path === failedTexture) throw failure; return image; });
    cleanups.push(() => image.destroy(true));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const terrain = await createHexTerrain(game, data);
    const meshes = terrain.container.children.filter((child): child is Mesh => child instanceof Mesh && Boolean(child.geometry.attributes.aTint));
    expect(meshes).toHaveLength(data.batches.length);
    data.batches.forEach((batch, index) => {
      const mesh = meshes[index]!;
      expect(mesh.geometry.getBuffer("aPosition").data).toEqual(batch.positions);
      expect(mesh.geometry.getBuffer("aTint").data).toEqual(batch.colors);
      if (batch.kind === "image") expect(mesh.shader!.resources.uTexture).toBe((batch.texture === failedTexture ? Texture.WHITE : image).source);
    });
    expect(warning).toHaveBeenCalledWith("Terrain texture unavailable", failure);
    for (const tile of grid) {
      const offset = data.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
      expect(tile.blocked).toBe(false);
      expect(hexTerrainAt(grid, data.faceOffsets, tile.x, tile.y + offset)).toBe(tile);
    }
    game.dispose();
    expect(terrain.container.destroyed).toBe(true);
    expect(image.source.destroyed).toBe(false);
  });

  it.each(["abort", "dispose"])("does not create fallback resources after %s during a failed image load", async (cancel) => {
    let reject = (_error: Error) => {};
    const pending = new Promise<Texture>((_resolve, fail) => { reject = fail; });
    const { game, controller, own } = renderer(() => pending);
    const terrain = createHexTerrain(game, prepare(mapOf(2, 2)).data);
    if (cancel === "abort") controller.abort(); else game.dispose();
    const failure = new Error("Image load failed after cancellation");
    reject(failure);
    await expect(terrain).rejects.toBe(failure);
    expect(own).not.toHaveBeenCalled();
  });

  it("preserves an image loader's AbortError even before its signal is aborted", async () => {
    const failure = new DOMException("Image load cancelled", "AbortError");
    const { game, own } = renderer(async () => { throw failure; });
    await expect(createHexTerrain(game, prepare(mapOf(2, 2)).data)).rejects.toBe(failure);
    expect(own).not.toHaveBeenCalled();
  });

  it("propagates terrain initialization errors after images load", async () => {
    const failure = new Error("Shader initialization failed");
    const { game } = renderer(async () => Texture.WHITE);
    vi.spyOn(Shader, "from").mockImplementation(() => { throw failure; });
    await expect(createHexTerrain(game, prepare(mapOf(2, 2)).data)).rejects.toBe(failure);
  });
});

describe("shared hex terrain data", () => {
  it("preserves positive fractional terrain costs in both navigation grids", () => {
    const map = mapOf(1, 1);
    map.tiles[0]!.walkCost = 0.5;
    expect(prepare(map).grid.getHex({ col: 0, row: 0 })?.cost).toBe(1.5);
    expect(buildWindowNav([{ dx: 0, dy: 0, map }], 10)?.toUnified(0, 0, 0, 0)?.cost).toBe(1.5);
  });

  it.each(["ground", "dessert", "snow", "ice", "ocean"] as const)("keeps shaded %s walkable in rendering, window navigation and server validation", (terrain) => {
    const map = mapOf(3, 1);
    map.tiles = map.tiles.map((tile) => ({ ...tile, terrain, battleBiome: terrain, blocked: tile.x === 1, walkCost: tile.x === 1 ? 0 : 1 }));
    const before = structuredClone(map);
    const { grid, data } = prepare(map);
    const tile = grid.getHex({ col: 1, row: 0 })!;
    expect(tile.blocked).toBe(false);
    expect(tile.cost).toBe(2);
    expect(new PathCalculator(grid).getShortestPath(grid.getHex({ col: 0, row: 0 })!, tile)).toBeDefined();
    const nav = buildWindowNav([{ dx: 0, dy: 0, map }], 10)!;
    expect(nav.toUnified(0, 0, 1, 0)?.blocked).toBe(false);
    expect(isWalkableCoordinate(map, { x: 1, y: 0 })).toBe(true);
    expect(isReachableCoordinate(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(isWalkableCoordinate(map, { x: -1, y: 0 })).toBe(false);
    // Movement does not rewrite the authored palette or its shaded appearance.
    expect(map).toEqual(before);
    if (terrain !== "ocean") {
      const batch = data.batches.find((batch) => batch.tiles.some((entry) => entry.key === "1,0"))!;
      const start = batch.tiles.find((entry) => entry.key === "1,0")!.start * 4;
      const color = Number.parseInt(tile.spec!.colors[2]!.slice(1), 16);
      expect([...batch.rawColors.slice(start, start + 4)]).toEqual([color >> 16, (color >> 8) & 255, color & 255, 255]);
    }
  });

  it.each([false, true])("outlines exposed faces at their terrain height (light layout: %s)", (light) => {
    const { grid, data } = prepare(mapOf(2, 1), light);
    const [land, water] = grid.toArray();
    expect(data.boundary.length).toBe(10 * 4);
    if (light) expect(data.faceOffsets.get("1,0")).toBe(0);
    else expect(data.faceOffsets.get("1,0")).toBeLessThan(0);
    for (const tile of [land!, water!]) {
      const offset = data.faceOffsets.get(`${tile.col},${tile.row}`)!;
      const exposedEdges = tile.corners.flatMap((a, index) => {
        const b = tile.corners[(index + 1) % tile.corners.length]!;
        const neighbor = tile === land ? water! : land!;
        // Shared grid edges are interior even when the two faces have different heights.
        if ([a, b].every((point) => neighbor.corners.some((corner) => Math.hypot(point.x - corner.x, point.y - corner.y) < 1e-4))) return [];
        return [a.x, a.y + offset, b.x, b.y + offset];
      });
      expect(exposedEdges).toHaveLength(5 * 4);
      for (let index = 0; index < exposedEdges.length; index += 4) {
        expect(Array.from({ length: data.boundary.length / 4 }, (_, edge) =>
          exposedEdges.slice(index, index + 4).every((value, coordinate) => Math.abs(value - data.boundary[edge * 4 + coordinate]!) < 1e-4),
        ).some(Boolean)).toBe(true);
      }
    }
  });

  it("picks each authored tile on its recessed face without renderer hit objects", () => {
    const { grid, data } = prepare(mapOf(26, 26));
    for (const tile of grid) {
      const offset = data.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
      expect(hexTerrainAt(grid, data.faceOffsets, tile.x, tile.y + offset)).toBe(tile);
    }
    expect(hexTerrainAt(grid, data.faceOffsets, -1000, -1000)).toBeNull();
  });
  it("keeps all terrain vertices in a few texture batches and preserves walkability data", () => {
    const map = mapOf(26, 26), before = JSON.stringify(map);
    const { data } = prepare(map);
    expect(JSON.stringify(map)).toBe(before);
    expect(data.batches.length).toBeLessThan(10);
    expect(data.batches.reduce((sum, batch) => sum + batch.positions.length / 2, 0)).toBe(26 * 26 * 12);
    expect(data.animatedTiles).toBeGreaterThan(0);
    expect(data.boundary.length).toBeGreaterThan(0);
    for (const batch of data.batches) {
      expect(batch.uvs.length).toBe(batch.positions.length);
      expect(batch.colors.length / 3).toBe(batch.positions.length / 2);
      expect(batch.rawColors.length / 4).toBe(batch.positions.length / 2);
      expect(batch.waves.length).toBe(batch.positions.length / 2);
      expect([...batch.positions, ...batch.uvs, ...batch.colors].every(Number.isFinite)).toBe(true);
    }
  });
  it("light layout drops texture requests, water animation and recessed geometry", () => {
    const { data } = prepare(mapOf(26, 26), true);
    expect(data.ground.length).toBe(0);
    expect(data.animatedTiles).toBe(0);
    expect([...data.faceOffsets.values()].every((offset) => offset === 0)).toBe(true);
    expect(data.batches.every((batch) => batch.kind === "solid" && batch.texture === null)).toBe(true);
  });
  it("keeps seeded terrain and water phases stable across renderer remounts", () => {
    const map = mapOf(8, 8);
    const a = prepare(map).data, b = prepare(map).data;
    expect(a.batches).toEqual(b.batches);
    expect(a.ground).toEqual(b.ground);
  });
});
