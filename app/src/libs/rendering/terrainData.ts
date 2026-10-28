import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";
import { linearRenderColor } from "@/libs/rendering/color";
import {
  calculateHexUVCoordinates,
  calculateTileOffset,
  createGroundCorners,
  getHexPoints,
} from "@/libs/rendering/hexGeometry";
import { parseHexColor } from "@/utils/color";

/** CPU draw data contains no renderer objects and can be retained across canvas mounts. */
export const buildHexTerrainData = (
  grid: Grid<TerrainHex>,
  look: (tile: TerrainHex) => TerrainLook,
  lightLayout: boolean,
) => {
  const { points, groundPoints, groundEdges } = getHexPoints();
  const tileUVArray = calculateHexUVCoordinates(grid.toArray()[0], points);
  const groups = new Map<string, TerrainBatchBuilder>();
  const ground: number[] = [],
    edges: number[] = [];
  const perimeter = new Map<string, { count: number; points: number[] }>();
  const faceOffsets = new Map<string, number>();
  let animatedTiles = 0;
  for (const tile of grid) {
    const material = look(tile);
    const { length, offsetLength, offsetLayer } = calculateTileOffset(
      tile.corners,
      material.depression,
      lightLayout,
    );
    faceOffsets.set(`${tile.col},${tile.row}`, offsetLength);
    const kind = lightLayout ? "solid" : material.texture ? "image" : "noise";
    const texture = lightLayout ? null : material.texture;
    const key = `${offsetLayer}:${kind}:${texture ?? ""}`;
    let batch = groups.get(key);
    if (!batch) {
      batch = {
        kind,
        texture,
        layer: offsetLayer,
        positions: [],
        uvs: [],
        colors: [],
        rawColors: [],
        waves: [],
        tiles: [],
      };
      groups.set(key, batch);
    }
    const linear = linearRenderColor(material.color),
      raw = parseHexColor(material.color);
    if (!raw) throw new Error(`Invalid terrain color ${material.color}`);
    const wave = lightLayout ? -1 : material.waveOffset;
    if (wave >= 0) animatedTiles++;
    batch.tiles.push({
      key: `${tile.col},${tile.row}`,
      start: batch.positions.length / 2,
      count: points.length,
    });
    points.forEach((corner, index) => {
      const point = tile.corners[corner];
      if (!point) return;
      batch.positions.push(point.x, point.y + offsetLength);
      batch.uvs.push(tileUVArray?.[index * 2] ?? 0, tileUVArray?.[index * 2 + 1] ?? 0);
      batch.colors.push(linear.r, linear.g, linear.b);
      batch.rawColors.push(raw.r, raw.g, raw.b, 255);
      batch.waves.push(wave);
    });
    tile.corners.forEach((a, index) => {
      const b = tile.corners[(index + 1) % tile.corners.length];
      if (!b) return;
      edges.push(a.x, a.y + offsetLength, b.x, b.y + offsetLength);
      const key = [a, b]
        .map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)
        .sort()
        .join(":");
      const previous = perimeter.get(key);
      if (previous) previous.count++;
      else perimeter.set(key, { count: 1, points: [a.x, a.y, b.x, b.y] });
    });
    if (!lightLayout) {
      const corners = createGroundCorners(tile.corners, offsetLength, length);
      for (const index of groundPoints) {
        const point = corners[index];
        if (point) ground.push(point.x, point.y);
      }
      for (const edge of groundEdges)
        for (const index of edge) {
          const point = corners[index];
          if (point) edges.push(point.x, point.y);
        }
    }
  }
  return {
    batches: [...groups.values()]
      .sort((a, b) => a.layer - b.layer)
      .map((batch) => ({
        ...batch,
        positions: new Float32Array(batch.positions),
        uvs: new Float32Array(batch.uvs),
        colors: new Float32Array(batch.colors),
        rawColors: new Uint8Array(batch.rawColors),
        waves: new Float32Array(batch.waves),
      })),
    ground: new Float32Array(ground),
    edges: new Float32Array(edges),
    boundary: new Float32Array(
      [...perimeter.values()]
        .filter((edge) => edge.count === 1)
        .flatMap((edge) => edge.points),
    ),
    faceOffsets,
    animatedTiles,
  };
};

/** Exact polygon checks around one arithmetic grid candidate replace invisible hit meshes. */
export const hexTerrainAt = (
  grid: Grid<TerrainHex>,
  offsets: ReadonlyMap<string, number>,
  x: number,
  y: number,
) => {
  const nearest = grid.pointToHex({ x, y }, { allowOutside: true });
  if (!nearest) return null;
  const candidates: TerrainHex[] = [];
  for (let col = nearest.col - 1; col <= nearest.col + 1; col++)
    for (let row = nearest.row - 1; row <= nearest.row + 1; row++) {
      const tile = grid.getHex({ col, row });
      if (tile) candidates.push(tile);
    }
  candidates.sort(
    (a, b) =>
      (offsets.get(`${b.col},${b.row}`) ?? 0) - (offsets.get(`${a.col},${a.row}`) ?? 0),
  );
  for (const tile of candidates) {
    const dy = offsets.get(`${tile.col},${tile.row}`) ?? 0;
    let sign = 0,
      inside = true;
    for (let index = 0; index < tile.corners.length; index++) {
      const a = tile.corners[index],
        b = tile.corners[(index + 1) % tile.corners.length];
      if (!a || !b) continue;
      const cross = (b.x - a.x) * (y - a.y - dy) - (b.y - a.y) * (x - a.x);
      if (Math.abs(cross) < 1e-7) continue;
      const next = Math.sign(cross);
      if (sign !== 0 && sign !== next) {
        inside = false;
        break;
      }
      sign = next;
    }
    if (inside) return tile;
  }
  return null;
};

export type TerrainLook = {
  color: string;
  texture: string | null;
  waveOffset: number;
  depression: number;
};
export type HexTerrainData = ReturnType<typeof buildHexTerrainData>;
type TerrainBatchBuilder = {
  kind: "solid" | "noise" | "image";
  texture: string | null;
  layer: number;
  positions: number[];
  uvs: number[];
  colors: number[];
  rawColors: number[];
  waves: number[];
  tiles: { key: string; start: number; count: number }[];
};
