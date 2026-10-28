import {
  type CharacterAssetConfig,
  HEAVY_ENEMY_ASSET_CONFIG,
  LIGHT_ENEMY_ASSET_CONFIG,
  PLAYER_ASSET_CONFIG,
} from "@/libs/rendering/characterAssets";
import type { CharacterAssetConfig as DbCharacterAssetConfig } from "@/validators/towerDefense";

const enemyAssetConfigCache = new Map<
  string,
  { config: CharacterAssetConfig; scaleFactor: number }
>();

/**
 * Cache for the current player's asset configuration and scale.
 * Set when a game session starts with a selected player character.
 */
let playerAssetConfigCache: {
  config: CharacterAssetConfig;
  scaleFactor: number;
} | null = null;

/**
 * Convert a database asset config (with full URLs) to the rendering format.
 * Database configs don't have basePath since they use absolute URLs.
 */
const convertDbConfigToAnimatorConfig = (
  dbConfig: DbCharacterAssetConfig,
): CharacterAssetConfig => {
  return {
    ...dbConfig,
    basePath: "", // Not used when URLs are absolute
  };
};

/**
 * Register an enemy asset config from the database.
 * Called when enemy definitions are loaded.
 */
export const registerEnemyAssetConfig = (
  enemyType: string,
  config: DbCharacterAssetConfig,
  scaleFactor: number,
): void => {
  const animatorConfig = convertDbConfigToAnimatorConfig(config);
  enemyAssetConfigCache.set(enemyType, { config: animatorConfig, scaleFactor });
};

/**
 * Clear all cached enemy asset configs.
 */
export const clearEnemyAssetConfigCache = (): void => {
  enemyAssetConfigCache.clear();
};

/**
 * Register the player's asset configuration.
 * Called when a game session starts with a selected player character.
 */
export const registerPlayerAssetConfig = (
  config: DbCharacterAssetConfig,
  scaleFactor: number,
): void => {
  const animatorConfig = convertDbConfigToAnimatorConfig(config);
  playerAssetConfigCache = { config: animatorConfig, scaleFactor };
};

/**
 * Clear the player asset config cache.
 */
export const clearPlayerAssetConfigCache = (): void => {
  playerAssetConfigCache = null;
};

/**
 * Get the current player's asset config.
 * Falls back to default PLAYER_ASSET_CONFIG if none registered.
 */
export const getPlayerAssetConfig = (): {
  config: CharacterAssetConfig;
  scaleFactor: number;
} => {
  if (playerAssetConfigCache) {
    return playerAssetConfigCache;
  }
  // Fallback to default hardcoded player config
  return { config: PLAYER_ASSET_CONFIG, scaleFactor: 2.8 };
};

/**
 * Get the asset config for an enemy type.
 * First checks the dynamic cache (database configs), then falls back to hardcoded.
 */
export const getEnemyAssetConfig = (
  enemyType: string,
): { config: CharacterAssetConfig; scaleFactor: number } => {
  // Check cache first (database configs)
  const cachedConfig = enemyAssetConfigCache.get(enemyType);
  if (cachedConfig) {
    return cachedConfig;
  }

  // Fallback to hardcoded configs for backwards compatibility
  const isHeavy = enemyType === "heavy";
  return {
    config: isHeavy ? HEAVY_ENEMY_ASSET_CONFIG : LIGHT_ENEMY_ASSET_CONFIG,
    scaleFactor: isHeavy ? 3.2 : 2.8,
  };
};
