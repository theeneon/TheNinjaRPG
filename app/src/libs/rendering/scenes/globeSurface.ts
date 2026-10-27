import type { LinearColor } from "@/libs/rendering/color";
import type {
  GlobalMapData,
  GlobalPoint,
  GlobalTile,
} from "@/libs/sector-map/world-types";

type Point3 = { x: number; y: number; z: number };

/** Quads per sector edge, falling back to a flat quad without a color field. */
const sectorVisualScale = (hexasphere: GlobalMapData, tile: GlobalTile) =>
  hexasphere.visualScale && tile.vc?.length === (hexasphere.visualScale + 1) ** 2
    ? hexasphere.visualScale
    : 1;

const FALLBACK_TERRAIN_COLORS: Record<number, number> = {
  0: 0x3f9ed9,
  1: 0x3cc164,
  2: 0xe7cd89,
  3: 0xe8f6f8,
};

/** Evenly spaced points along one sector edge, as flat xyz triples. */
const interpolateEdge = (
  from: GlobalPoint,
  to: GlobalPoint,
  stride: number,
  scale: number,
) => {
  const points = new Float64Array(stride * 3);
  for (let step = 0; step < stride; step++) {
    const amount = step / scale;
    points[step * 3] = Number(from.x) + (Number(to.x) - Number(from.x)) * amount;
    points[step * 3 + 1] = Number(from.y) + (Number(to.y) - Number(from.y)) * amount;
    points[step * 3 + 2] = Number(from.z) + (Number(to.z) - Number(from.z)) * amount;
  }
  return points;
};

/**
 * One indexed geometry for the whole navigable globe, subdivided and colored at
 * each sector's climate-field vertices. The GPU interpolates those colors
 * across the triangles, producing gradual coast and biome transitions.
 *
 * Merging matters: a mesh per sector meant ~1,950 draw calls every frame, which
 * is what made the map crawl on mobile. Sector identity survives as the
 * vertexRanges lookup, and picking is arithmetic (see globeSectorAt) rather
 * than a raycast, so nothing needs the tiles to stay separate objects.
 */
export const buildGlobeSurfaceData = (
  hexasphere: GlobalMapData,
  sectorTint?: (sector: number) => LinearColor | null,
) => {
  const tiles = hexasphere.tiles;
  const radius = hexasphere.radius / 3;

  // Size the buffers up front: a sector contributes (scale + 1)^2 vertices and
  // scale^2 quads, and sectors without a proper quad boundary contribute none.
  const scales = new Int32Array(tiles.length);
  let vertexTotal = 0;
  let indexTotal = 0;
  for (let sector = 0; sector < tiles.length; sector++) {
    const tile = tiles[sector];
    if (!tile || tile.b.length !== 4) continue;
    const scale = sectorVisualScale(hexasphere, tile);
    scales[sector] = scale;
    vertexTotal += (scale + 1) ** 2;
    indexTotal += scale * scale * 6;
  }

  const positions = new Float32Array(vertexTotal * 3);
  const colors = new Float32Array(vertexTotal * 3);
  const indices = new Uint32Array(indexTotal);
  const vertexRanges = new Int32Array(tiles.length * 2).fill(-1);
  let vertexCursor = 0;
  let indexCursor = 0;

  for (let sector = 0; sector < tiles.length; sector++) {
    const scale = scales[sector];
    const tile = tiles[sector];
    if (!scale || !tile) continue;
    const [nw, ne, se, sw] = tile.b as [
      GlobalPoint,
      GlobalPoint,
      GlobalPoint,
      GlobalPoint,
    ];
    const stride = scale + 1;
    const base = vertexCursor;
    const tint = sectorTint?.(sector) ?? null;

    // Bilinear interpolation over the quad, evaluated as a north edge and a
    // south edge that the row loop then blends between.
    const north = interpolateEdge(nw, ne, stride, scale);
    const south = interpolateEdge(sw, se, stride, scale);

    for (let y = 0; y < stride; y++) {
      const v = y / scale;
      for (let x = 0; x < stride; x++) {
        // Blended point pushed back onto the sphere, so the surface stays
        // curved rather than faceted.
        const edge = x * 3;
        const nx = north[edge] ?? 0;
        const ny = north[edge + 1] ?? 0;
        const nz = north[edge + 2] ?? 0;
        const px = nx + ((south[edge] ?? 0) - nx) * v;
        const py = ny + ((south[edge + 1] ?? 0) - ny) * v;
        const pz = nz + ((south[edge + 2] ?? 0) - nz) * v;
        const length = Math.hypot(px, py, pz) || 1;
        const offset = (base + y * stride + x) * 3;
        positions[offset] = (px / length) * radius;
        positions[offset + 1] = (py / length) * radius;
        positions[offset + 2] = (pz / length) * radius;

        const packed =
          tile.vc?.[y * stride + x] ?? FALLBACK_TERRAIN_COLORS[tile.t] ?? 0x3cc164;
        const red = ((packed >> 16) & 0xff) / 255;
        const green = ((packed >> 8) & 0xff) / 255;
        const blue = (packed & 0xff) / 255;
        colors[offset] = tint ? red * tint.r : red;
        colors[offset + 1] = tint ? green * tint.g : green;
        colors[offset + 2] = tint ? blue * tint.b : blue;
      }
    }

    for (let y = 0; y < scale; y++) {
      for (let x = 0; x < scale; x++) {
        const topLeft = base + y * stride + x;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + stride;
        const bottomRight = bottomLeft + 1;
        indices[indexCursor++] = topLeft;
        indices[indexCursor++] = topRight;
        indices[indexCursor++] = bottomRight;
        indices[indexCursor++] = topLeft;
        indices[indexCursor++] = bottomRight;
        indices[indexCursor++] = bottomLeft;
      }
    }

    vertexRanges[sector * 2] = base;
    vertexRanges[sector * 2 + 1] = stride * stride;
    vertexCursor += stride * stride;
  }

  return { positions, colors, indices, vertexRanges };
};

export const samplePolarCapColor = (
  hexasphere: GlobalMapData,
  point: Point3,
): Point3 | null => {
  const rows = hexasphere.polarCapRows;
  const columns = hexasphere.polarCapColumns;
  const latitudeLimit = hexasphere.latitudeLimit;
  const packedCaps = hexasphere.polarCapColors;
  if (!rows || !columns || latitudeLimit === undefined || !packedCaps) return null;
  const expectedLength = (rows + 1) * (columns + 1);
  if (
    packedCaps.north.length !== expectedLength ||
    packedCaps.south.length !== expectedLength
  ) {
    return null;
  }

  const length = Math.hypot(point.x, point.y, point.z) || 1;
  const latitude = (Math.asin(point.y / length) * 180) / Math.PI;
  const absoluteLatitude = Math.abs(latitude);
  if (absoluteLatitude < latitudeLimit) return null;

  const packed = latitude >= 0 ? packedCaps.north : packedCaps.south;
  const ring = Math.min(
    rows,
    ((absoluteLatitude - latitudeLimit) / (90 - latitudeLimit)) * rows,
  );
  const longitude = Math.atan2(point.z, point.x);
  const column = ((longitude + Math.PI) / (Math.PI * 2)) * columns;
  const ring0 = Math.floor(ring);
  const ring1 = Math.min(rows, ring0 + 1);
  const column0 = Math.min(columns, Math.floor(column));
  const column1 = column0 === columns ? columns : column0 + 1;
  const ringMix = ring - ring0;
  const columnMix = column - column0;
  const stride = columns + 1;
  const unpack = (value: number): Point3 => ({
    x: ((value >> 16) & 0xff) / 255,
    y: ((value >> 8) & 0xff) / 255,
    z: (value & 0xff) / 255,
  });
  const mix = (a: Point3, b: Point3, amount: number): Point3 => ({
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
    z: a.z + (b.z - a.z) * amount,
  });
  const at = (sampleRing: number, sampleColumn: number) => {
    return unpack(packed[sampleRing * stride + sampleColumn] ?? 0xe8f6f8);
  };
  const upper = mix(at(ring0, column0), at(ring0, column1), columnMix);
  const lower = mix(at(ring1, column0), at(ring1, column1), columnMix);
  return mix(upper, lower, ringMix);
};
