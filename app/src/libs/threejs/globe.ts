import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  type Raycaster,
  Sphere,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import { buildGlobeSurfaceData } from "@/libs/rendering/scenes/globeSurface";
import { sectorAtGeographic } from "@/libs/sector-map/world-grid";
import type {
  GlobalMapData,
  GlobalPoint,
  GlobalTile,
} from "@/libs/sector-map/world-types";
import {
  createBorderTexture,
  loadTexture,
  pickSpriteAvatar,
} from "@/libs/threejs/util";

export { fetchMap } from "@/libs/sector-map/topology";

/**
 * Create a user avatar sprite for the global map
 *
 * MEMORY OPTIMIZATION: Border textures are cached in util.ts to prevent memory leaks.
 * Previously, each call created a new canvas, causing OOM errors on Firefox.
 * Now border textures are cached by color and disposed during component cleanup.
 */
export const createUserAvatarSprite = (info: {
  userData: {
    userId: string;
    sector: number;
    avatar: string | null;
    avatarLight: string | null;
  };
  sector: GlobalPoint;
  showLine: boolean;
  borderColor: string;
  distance: number;
}) => {
  const { userData, sector, borderColor = "white", distance } = info;
  if (!userData) return new Group();

  const group = new Group();
  // three.js resets its group sort-order at every nested Group, so this group
  // does NOT inherit the parent group_highlights order. Without an explicit
  // renderOrder the sprites tie with the translucent sector grid and fall back
  // to distance sorting, which they lose near the globe's limb — letting grid
  // lines draw over the marker. depthTest still occludes far-side markers.
  group.renderOrder = 2;

  // Distance from the surface
  const d = 3 - distance;

  // Create the line connecting to the surface
  if (info.showLine) {
    const points = [];
    points.push(new Vector3(sector.x / 3, sector.y / 3, sector.z / 3));
    points.push(new Vector3(sector.x / d, sector.y / d, sector.z / d));
    const lineMaterial = new LineBasicMaterial({
      color: "#000000",
      linewidth: 1,
    });
    const geometry = new BufferGeometry().setFromPoints(points);
    const line = new LineSegments(geometry, lineMaterial);
    group.add(line);
  }

  // Create circular border sprite using cached texture
  const borderTexture = createBorderTexture(borderColor, 64);

  const borderMaterial = new SpriteMaterial({
    map: borderTexture,
    // The border ring is alpha-cut; without this the sprite renders in the
    // OPAQUE pass, which draws before the translucent sector grid and so lets
    // the grid lines paint over the marker (and squares off its corners)
    transparent: true,
    depthWrite: false,
    // depthTest so the opaque globe hides markers that are on its far side; the
    // sprite floats just above the surface (see distance) so the near side shows
    depthTest: true,
  });
  const borderSprite = new Sprite(borderMaterial);
  borderSprite.scale.set(1.2, 1.2, 1.2); // Slightly larger than avatar
  borderSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(borderSprite);

  // User avatar sprite
  const alphaMap = loadTexture(IMG_SECTOR_USER_SPRITE_MASK);
  const avatar = pickSpriteAvatar(userData);
  const avatarTexture = loadTexture(avatar);
  avatarTexture.generateMipmaps = false;
  avatarTexture.minFilter = LinearFilter;
  const avatarMaterial = new SpriteMaterial({
    map: avatarTexture,
    alphaMap: alphaMap,
    // Required for the circular alphaMap mask to blend at all, and to keep the
    // sprite out of the opaque pass (see borderMaterial above)
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const avatarSprite = new Sprite(avatarMaterial);
  avatarSprite.scale.set(1, 1, 1);
  avatarSprite.position.set(sector.x / d, sector.y / d, sector.z / d);
  group.add(avatarSprite);

  return group;
};

export { samplePolarCapColor } from "@/libs/rendering/scenes/globeSurface";

/** Compatibility for the retained scene until its Pixi caller is installed. */
export const buildGlobeSurface = (
  map: GlobalMapData,
  sectorTint?: (sector: number) => Color | null,
) => {
  const { positions, colors, indices, vertexRanges } = buildGlobeSurfaceData(
    map,
    sectorTint,
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  return { geometry, vertexRanges };
};

// Reused across picks so hover testing allocates nothing per frame.
const pickSphere = new Sphere(new Vector3(0, 0, 0), 1);
const pickPoint = new Vector3();

/**
 * Sector under a ray, or null off the globe and over the non-navigable polar
 * caps. The sector grid is a uniform longitude/latitude layout, so the surface
 * hit resolves arithmetically - no per-triangle raycast, and no dependency on
 * how the terrain happens to be split into meshes.
 */
export const pickGlobeSector = (
  raycaster: Raycaster,
  hexasphere: GlobalMapData,
): number | null => {
  pickSphere.radius = hexasphere.radius / 3;
  if (!raycaster.ray.intersectSphere(pickSphere, pickPoint)) return null;
  const length = pickPoint.length() || 1;
  const latitude = (Math.asin(pickPoint.y / length) * 180) / Math.PI;
  const longitude = (Math.atan2(pickPoint.z, pickPoint.x) * 180) / Math.PI;
  const sector = sectorAtGeographic(latitude, longitude);
  return sector < 0 || sector >= hexasphere.tiles.length ? null : sector;
};
