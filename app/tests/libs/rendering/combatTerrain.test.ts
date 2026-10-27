import alea from "alea";
import { describe, expect, it } from "bun:test";
import { COMBAT_BIOMES } from "@/drizzle/constants";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getProceduralTerrain } from "@/libs/rendering/proceduralBiomes";
import { isCombatTile, prepareCombatTerrain } from "@/libs/rendering/scenes/combatTerrain";
import { hexTerrainAt } from "@/libs/rendering/terrainData";

const battle = (background: ReturnedBattle["background"] = "ground") => ({ id: "battle", width: 12, height: 10, background }) as ReturnedBattle;
const prepare = (background: ReturnedBattle["background"], light = false) => prepareCombatTerrain(1024, battle(background), alea("arena"), light);

describe("combat terrain preparation", () => {
  it("preserves the procedural biome threshold boundaries", () => {
    expect(getProceduralTerrain({ level: 0.04 }, "ground").spec.key).toBe("ocean");
    expect(getProceduralTerrain({ level: 0.2 }, "ground")).toMatchObject({ spec: { key: "ground" }, variant: 1 });
    expect(getProceduralTerrain({ level: 0.9 }, "ocean")).toMatchObject({ spec: { key: "dessert" }, variant: 2 });
    expect(getProceduralTerrain({ level: 0.25 }, "ice").spec.key).toBe("snow");
  });
  it.each(COMBAT_BIOMES)("keeps the %s grid, costs and decorations deterministic", (background) => {
    const first = prepare(background), second = prepare(background);
    expect(first.scenery).toEqual(second.scenery);
    expect(first.terrain.batches).toEqual(second.terrain.batches);
    expect(first.grid.size).toBe(120);
    expect(first.grid.toArray().map((tile) => tile.cost)).toEqual(second.grid.toArray().map((tile) => tile.cost));
    for (const tile of first.grid) {
      expect([2, 6]).toContain(tile.cost);
      const offset = first.terrain.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
      expect(hexTerrainAt(first.grid, first.terrain.faceOffsets, tile.x, tile.y + offset)).toBe(tile);
    }
    for (const sprite of first.scenery) {
      const coordinates = sprite.id.replace("scenery:", "").split(",").map(Number);
      if (isCombatTile({ col: coordinates[0] ?? -1, row: coordinates[1] ?? -1 }, battle(background))) expect(sprite.small).toBe(true);
    }
  });
  it("light layout retains navigation while dropping decoration and animation work", () => {
    const full = prepare("ground"), light = prepare("ground", true);
    expect(light.grid.toArray().map((tile) => tile.cost)).toEqual(full.grid.toArray().map((tile) => tile.cost));
    expect(light.scenery).toEqual([]);
    expect(light.terrain.animatedTiles).toBe(0);
  });
});
