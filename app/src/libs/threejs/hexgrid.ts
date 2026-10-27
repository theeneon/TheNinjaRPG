import type * as THREE from "three";
import { BufferAttribute, BufferGeometry, Line, type LineBasicMaterial } from "three";
import type { TerrainHex } from "../hexgrid";

/**
 * Hex mesh used by scene hit testing
 */
export interface HexagonalFaceMesh
  extends THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  currentHex: number;
  userData: {
    id: number;
    hex: number;
    tile: TerrainHex;
    highlight: boolean;
    selected: boolean;
    canClick: boolean;
    originalColor?: THREE.Color;
    isBattleTile?: boolean;
  };
}

/**
 * Creates the top face geometry for a hex tile
 */
export const createTileGeometry = (info: {
  corners: Array<{ x: number; y: number }> | ReadonlyArray<{ x: number; y: number }>;
  points: number[];
  tileUVArray: Float32Array | null;
  offsetLength: number;
  offsetLayer: number;
  layer: number;
}) => {
  const { corners, points, tileUVArray, offsetLength, offsetLayer, layer } = info;
  const geometry = new BufferGeometry();

  // Safety: ensure corners exist and points are valid
  if (!corners || corners.length === 0) {
    return geometry;
  }

  const vertices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const pIdx = points[i];
    const p = pIdx !== undefined ? corners[pIdx] : undefined;
    if (p) {
      vertices.push(p.x, p.y + offsetLength, layer + offsetLayer);
    }
  }

  geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
  if (tileUVArray) {
    geometry.setAttribute("uv", new BufferAttribute(tileUVArray, 2));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};

/**
 * Creates the ground (dirt) geometry below a hex tile
 */
export const createGroundGeometry = (info: {
  groundCorners: ReadonlyArray<{ x: number; y: number }>;
  groundPoints: number[];
  groundUVArray: Float32Array | null;
  layer: number;
}) => {
  const { groundCorners, groundPoints, groundUVArray, layer } = info;
  const groundGeometry = new BufferGeometry();
  const groundVertices = new Float32Array(
    groundPoints
      .map((p) => groundCorners[p])
      .flatMap((p) => (p ? [p.x, p.y, layer] : [])),
  );
  groundGeometry.setAttribute("position", new BufferAttribute(groundVertices, 3));
  if (groundUVArray) {
    groundGeometry.setAttribute("uv", new BufferAttribute(groundUVArray, 2));
  }
  return groundGeometry;
};

/**
 * Creates vertical edge lines for the ground geometry
 */
export const createGroundEdges = (info: {
  groundCorners: ReadonlyArray<{ x: number; y: number }>;
  groundEdges: number[][];
  lineMaterial: LineBasicMaterial;
  layer: number;
}) => {
  const { groundCorners, groundEdges, lineMaterial, layer } = info;
  const edgeMeshes: Line[] = [];

  groundEdges.forEach((edge) => {
    const edgeGeometry = new BufferGeometry();
    const edgeVertices = new Float32Array(
      edge.map((p) => groundCorners[p]).flatMap((p) => (p ? [p.x, p.y, layer] : [])),
    );
    edgeGeometry.setAttribute("position", new BufferAttribute(edgeVertices, 3));
    const edgeMesh = new Line(edgeGeometry, lineMaterial);
    edgeMeshes.push(edgeMesh);
  });

  return edgeMeshes;
};

/**
 * Merges multiple BufferGeometries into a single geometry for performance
 * This dramatically reduces draw calls by combining many meshes into one
 */
export const mergeBufferGeometries = (geometries: BufferGeometry[]): BufferGeometry => {
  if (geometries.length === 0) {
    return new BufferGeometry();
  }

  // Calculate total vertices count
  let totalVertices = 0;
  let totalUVs = 0;
  const hasUV = geometries[0]?.attributes.uv !== undefined;

  geometries.forEach((geometry) => {
    const positions = geometry.attributes.position;
    if (positions) {
      totalVertices += positions.count * 3;
      if (hasUV && geometry.attributes.uv) {
        totalUVs += geometry.attributes.uv.count * 2;
      }
    }
  });

  // Create merged arrays
  const mergedPositions = new Float32Array(totalVertices);
  const mergedUVs = hasUV ? new Float32Array(totalUVs) : null;

  let positionOffset = 0;
  let uvOffset = 0;

  // Copy all geometry data into merged arrays
  geometries.forEach((geometry) => {
    const positions = geometry.attributes.position;
    if (positions) {
      mergedPositions.set(positions.array as Float32Array, positionOffset);
      positionOffset += positions.count * 3;

      if (hasUV && geometry.attributes.uv && mergedUVs) {
        const uvs = geometry.attributes.uv;
        mergedUVs.set(uvs.array as Float32Array, uvOffset);
        uvOffset += uvs.count * 2;
      }
    }
  });

  // Create merged geometry
  const mergedGeometry = new BufferGeometry();
  mergedGeometry.setAttribute("position", new BufferAttribute(mergedPositions, 3));
  if (hasUV && mergedUVs) {
    mergedGeometry.setAttribute("uv", new BufferAttribute(mergedUVs, 2));
  }

  return mergedGeometry;
};
