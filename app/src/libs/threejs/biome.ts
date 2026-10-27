import {
  AddOperation,
  DoubleSide,
  MeshBasicMaterial,
  RepeatWrapping,
  Sprite,
  SpriteMaterial,
  Texture,
} from "three";
import type { CombatBiome } from "@/drizzle/constants";
import { ASSETS_LAYER } from "@/drizzle/constants";
import {
  getProceduralTerrain,
  proceduralDecoration,
} from "@/libs/rendering/proceduralBiomes";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import type { GlobalTile } from "@/libs/sector-map/world-types";
import { applyWindShader } from "@/libs/threejs/shaders";
import { createSpriteMaterial, loadTexture } from "@/libs/threejs/util";
import type { TerrainHex } from "../hexgrid";

/** Parse a "#rrggbb" registry color into a three.js color int */
const hexToInt = (hex: string) => {
  const parsed = Number.parseInt(hex.replace("#", ""), 16);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid terrain color ${hex}`);
  }
  return parsed;
};

/**
 * Helper function to create textured materials from colors and texture URL
 * Adds subtle lightness variation for variety
 * Falls back to simple color materials on server-side (no window)
 */
const createTexturedMaterials = (colors: readonly number[], textureUrl: string) => {
  // Fallback to simple materials on server-side where window is not available
  if (typeof window === "undefined") {
    return colors.map((color) => markShared(new MeshBasicMaterial({ color })));
  }

  return colors.map((color) => {
    const texture = loadTexture(textureUrl);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1, 1);
    return markShared(
      new MeshBasicMaterial({ color: color, map: texture, combine: AddOperation }),
    );
  });
};

/** Module-level palette materials are shared; per-sector disposal skips them */
const markShared = <T extends MeshBasicMaterial | SpriteMaterial>(material: T): T => {
  material.userData.shared = true;
  return material;
};

/**
 * Helper function to create textured materials from colors and texture URL
 * Adds subtle lightness variation for variety
 * Falls back to simple color materials on server-side (no document)
 */
const createNoisedMaterials = (colors: readonly number[]) => {
  // Fallback to simple materials on server-side where document is not available
  if (typeof document === "undefined") {
    return colors.map((color) => markShared(new MeshBasicMaterial({ color })));
  }

  return colors.map((color) => {
    // Create a small canvas for the noisy texture
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return markShared(new MeshBasicMaterial({ color }));
    }
    // Fill with solid color
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.fillRect(0, 0, size, size);

    // Add random noise
    const imageData = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < size * size * 4; i += 4) {
      const noise = Math.floor(Math.random() * 32) - 16; // -16 to +15
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      if (r !== undefined) imageData.data[i] = Math.min(255, Math.max(0, r + noise));
      if (g !== undefined)
        imageData.data[i + 1] = Math.min(255, Math.max(0, g + noise));
      if (b !== undefined)
        imageData.data[i + 2] = Math.min(255, Math.max(0, b + noise));
      // alpha (i+3) remains unchanged (255)
    }
    ctx.putImageData(imageData, 0, 0);

    const texture = new Texture(canvas);
    texture.needsUpdate = true;
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(1, 1);

    return markShared(
      new MeshBasicMaterial({ color, map: texture, combine: AddOperation }),
    );
  });
};

/**
 * Helper function to create light (color-only) materials
 */
const createLightMaterials = (colors: readonly number[]) => {
  return colors.map((color) => markShared(new MeshBasicMaterial({ color })));
};

/** Full and light (color-only) material variants for one terrain look */
export interface TerrainMaterialSet {
  variants: MeshBasicMaterial[];
  lightVariants: MeshBasicMaterial[];
}

const terrainMaterialCache = new Map<string, TerrainMaterialSet>();
// Identity fast-path: within a window the same TerrainSpec object is resolved
// once per tile (~676x per sector), so cache by object identity to skip
// rebuilding the string cache key (a spread + join allocation) on every tile.
// A registry rebuild yields fresh spec objects, so this never serves stale art.
const terrainMaterialBySpec = new WeakMap<TerrainSpec, TerrainMaterialSet>();

/**
 * Builds terrain materials on demand from a TerrainSpec (the content-managed
 * terrain library). Cached by look (key + colors + textureUrl) so every sector
 * in the 3x3 window shares one material set per terrain — keeping geometry
 * merging effective — while an admin color/texture edit naturally yields a
 * fresh set. Textured variants when spec.textureUrl is set, noised canvas
 * variants otherwise; all materials are marked userData.shared so per-sector
 * disposal skips them.
 */
export const getTerrainMaterials = (spec: TerrainSpec): TerrainMaterialSet => {
  const identityHit = terrainMaterialBySpec.get(spec);
  if (identityHit) return identityHit;
  const cacheKey = [spec.key, ...spec.colors, spec.textureUrl ?? ""].join("|");
  const cached = terrainMaterialCache.get(cacheKey);
  if (cached) {
    terrainMaterialBySpec.set(spec, cached);
    return cached;
  }
  const colors = spec.colors.map(hexToInt);
  const set: TerrainMaterialSet = {
    variants: spec.textureUrl
      ? createTexturedMaterials(colors, spec.textureUrl)
      : createNoisedMaterials(colors),
    lightVariants: createLightMaterials(colors),
  };
  terrainMaterialCache.set(cacheKey, set);
  terrainMaterialBySpec.set(spec, set);
  return set;
};

export const roadColors = [0xa98e62, 0x9d8156, 0x8f744c] as const;
export const roadMats = createNoisedMaterials(roadColors);
export const roadMatsLight = createLightMaterials(roadColors);

export const shoreColors = [0xf2e2a4, 0xe6d190, 0xd8bf7d] as const;
export const shoreMats = createNoisedMaterials(shoreColors);
export const shoreMatsLight = createLightMaterials(shoreColors);

interface TileInfo {
  material: MeshBasicMaterial;
  dirt: MeshBasicMaterial;
  sprites: Sprite[];
  asset: string;
}

/** Flat dirt-colored fill rendered beneath the hex tiles */
export const getDirtMaterial = () => {
  return new MeshBasicMaterial({ color: 0x696969, side: DoubleSide });
};

/**
 * Material for one authored sector tile: the terrain's own shades only (light
 * or mid picked by noise; the dark shade marks blocked land so thickets and
 * rocks read as impassable). Water stays in its regular shades when blocked -
 * a lake is water, not a rock.
 */
export const getAuthoredTileMaterial = (
  hex: TerrainHex,
  spec: TerrainSpec,
  blocked: boolean,
  lightLayout = false,
) => {
  const set = getTerrainMaterials(spec);
  const mats = lightLayout ? set.lightVariants : set.variants;
  const variant = blocked && !spec.isWater ? 2 : hex.level < 0.5 ? 0 : 1;
  return {
    material: mats[variant] ?? mats[0],
    asset: spec.key,
  } as TileInfo;
};

export const getTileInfo = (
  prng: () => number,
  hex: TerrainHex,
  tile: GlobalTile | CombatBiome,
  lightLayout = false,
) => {
  const material = getMaterial(hex, tile, lightLayout);
  material.sprites = getMapSprites(prng, material.asset, hex);
  material.dirt = getDirtMaterial();
  return material;
};

/**
 * Seeded decoration sprites for one hex on the procedural render path (combat
 * arenas): sprite art derives from the asset set and the tile's cost band.
 */
export const getMapSprites = (prng: () => number, asset: string, hex: TerrainHex) => {
  const { cost, description } = proceduralDecoration(prng, asset, hex);
  hex.cost = cost;
  if (!description) return [];
  const sprite = loadSectorAsset(
    description.image,
    (description.wind ?? 0) / (Math.PI * 2),
    description.wind !== null && description.wind !== undefined,
    false,
  );
  sprite.scale.set(description.size, description.size, 1);
  sprite.position.set(description.x, description.y, ASSETS_LAYER);
  sprite.userData.small = description.small === true;
  sprite.userData.rotation = description.rotation ?? 0;
  return [sprite];
};

// Performance optimization: Cache materials for wind-affected assets to allow sharing
const windMaterialCache = new Map<string, MeshBasicMaterial | SpriteMaterial>();

/**
 * Sprite for a decoration image. Wind-affected decorations use the cached
 * wind-shader material (shared across sectors, so disposal must skip it);
 * `rand` drives the deterministic rotation variant when randomRotation is set.
 */
export const loadSectorAsset = (
  filepath: string,
  rand: number,
  windAffected?: boolean | null,
  randomRotation?: boolean,
) => {
  const texture = loadTexture(filepath);

  let material: SpriteMaterial;

  if (windAffected) {
    // Use one of 8 wind variants to allow material sharing while maintaining desynchronization
    const numVariants = 4;
    const variantIndex = Math.floor(rand * numVariants);
    const variantOffset = (variantIndex / numVariants) * Math.PI * 2;
    const cacheKey = `${filepath}-wind-${variantIndex}`;

    const cached = windMaterialCache.get(cacheKey) as SpriteMaterial | undefined;
    if (cached) {
      material = cached;
    } else {
      // Create a fresh material for this variant
      // We don't use the standard createSpriteMaterial here because we're modifying it
      material = markShared(
        new SpriteMaterial({
          map: texture,
          alphaTest: 0.5,
        }),
      );
      applyWindShader(material, variantOffset);
      windMaterialCache.set(cacheKey, material);
    }
  } else {
    // For non-wind assets, use standard sharing
    material = createSpriteMaterial(texture);
  }

  const sprite = new Sprite(material);

  // Apply random rotation if specified
  if (randomRotation) {
    // PERFORMANCE OPTIMIZATION: Store rotation in userData to be used by InstancedMesh
    // This avoids cloning materials just for rotation
    sprite.userData.rotation = rand * Math.PI * 2;
  }

  return sprite;
};

/**
 * Returns the material for a given hexagon and tile
 * @param hex - The hexagon to get the material for
 * @param tile - The tile to get the material for
 * @param lightLayout - Whether to use the light layout
 * @returns The material for the given hexagon and tile
 */
const getMaterial = (
  hex: TerrainHex,
  tile: GlobalTile | CombatBiome,
  lightLayout = false,
) => {
  const { spec, variant } = getProceduralTerrain(hex, tile);
  const materials = getTerrainMaterials(spec);
  return {
    material: (lightLayout ? materials.lightVariants : materials.variants)[variant],
    asset: spec.key,
  } as TileInfo;
};
