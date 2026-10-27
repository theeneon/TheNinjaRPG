import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";
import { buildHexTerrainData } from "@/libs/rendering/terrainData";

export const buildSectorTerrainData = (
  grid: Grid<TerrainHex>,
  prng: () => number,
  lightLayout: boolean,
) =>
  buildHexTerrainData(
    grid,
    (tile) => {
      const spec = tile.spec;
      if (!spec) throw new Error("Sector terrain must be resolved before drawing");
      tile.asset = spec.key;
      const road = tile.authored?.zone === "road" && !spec.isWater;
      const shore =
        tile.authored?.terrain === "dessert" && tile.authored.decoration === false;
      const colors = shore ? SHORE_COLORS : road ? ROAD_COLORS : spec.colors;
      const variant = shore
        ? tile.level < 0.4
          ? 0
          : tile.level < 0.7
            ? 1
            : 2
        : road
          ? tile.level < 0.4
            ? 0
            : tile.level < 0.6
              ? 1
              : 2
          : tile.blocked && !spec.isWater
            ? 2
            : tile.level < 0.5
              ? 0
              : 1;
      return {
        color: colors[variant] ?? colors[0],
        texture: road || shore ? null : spec.textureUrl,
        waveOffset:
          spec.isWater && !road && !lightLayout
            ? (Math.floor(prng() * 8) * Math.PI) / 4
            : -1,
        depression: road ? 0 : spec.depression,
      };
    },
    lightLayout,
  );

const ROAD_COLORS = ["#a98e62", "#9d8156", "#8f744c"] as const;
const SHORE_COLORS = ["#f2e2a4", "#e6d190", "#d8bf7d"] as const;
