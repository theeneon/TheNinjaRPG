import alea from "alea";
import { describe, expect, it } from "bun:test";
import { SECTOR_MAP_VERSION } from "@/drizzle/constants";
import { buildSectorTerrainData } from "@/libs/rendering/sectorData";
import { hexTerrainAt } from "@/libs/rendering/terrainData";
import { prepareSectorGrid } from "@/libs/sector-map/sector-grid";
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

describe("shared hex terrain data", () => {
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
