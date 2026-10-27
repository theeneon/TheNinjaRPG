import type { Intersection, Object3D } from "three";

/**
 * Cached raycaster intersections to avoid redundant calculations
 * Performance optimization: run raycaster.intersectObjects() once per frame
 * instead of 4+ times (once per highlight function)
 */
export type CachedIntersections = {
  tiles: Intersection<Object3D>[];
  battleTiles: Intersection<Object3D>[];
  ground: Intersection<Object3D>[];
  users?: Intersection<Object3D>[];
};
