import {
  type CharacterAssetConfig as DbCharacterAssetConfig,
  spriteDirections,
} from "@/validators/towerDefense";

/** Bundled characters may prefix relative paths; database configurations use full URLs. */
export interface CharacterAssetConfig extends DbCharacterAssetConfig {
  basePath?: string;
}

export const PLAYER_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/player",
  rotations: rotationPaths(),
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 100,
      loop: true,
      frames: framePaths("fight-stance-idle-8-frames", 8),
    },
    {
      name: "throw-object",
      state: "throw",
      frameDurationMs: 60,
      loop: false,
      frames: framePaths("throw-object", 7),
    },
  ],
};

export const LIGHT_ENEMY_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/light_character",
  rotations: rotationPaths(),
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 120,
      loop: true,
      frames: framePaths("fight-stance-idle-8-frames", 8),
    },
    {
      name: "running-6-frames",
      state: "moving",
      frameDurationMs: 80,
      loop: true,
      frames: framePaths("running-6-frames", 6),
    },
    {
      name: "lead-jab",
      state: "punch",
      frameDurationMs: 100,
      loop: false,
      frames: framePaths("lead-jab", 3),
    },
  ],
};

export const HEAVY_ENEMY_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/heavy_character",
  rotations: rotationPaths(),
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 150, // Slower idle for heavy feel
      loop: true,
      frames: framePaths("fight-stance-idle-8-frames", 8),
    },
    {
      name: "walking-6-frames",
      state: "moving",
      frameDurationMs: 120, // Slower than light enemy's running
      loop: true,
      frames: framePaths("walking-6-frames", 6),
    },
    {
      name: "lead-jab",
      state: "punch",
      frameDurationMs: 150, // Slower punch animation for heavy feel
      loop: false,
      frames: framePaths("lead-jab", 3),
    },
  ],
};

/** Each bundled fallback uses the same directional filenames; keep its maps independently owned. */
function rotationPaths(): CharacterAssetConfig["rotations"] {
  return Object.fromEntries(
    spriteDirections.map((direction) => [direction, `rotations/${direction}.png`]),
  ) as CharacterAssetConfig["rotations"];
}

/** Frame counts belong to each authored animation, while the directory layout is uniform. */
function framePaths(
  name: string,
  count: number,
): CharacterAssetConfig["animations"][number]["frames"] {
  return Object.fromEntries(
    spriteDirections.map((direction) => [
      direction,
      Array.from(
        { length: count },
        (_, index) => `animations/${name}/${direction}/frame_00${index}.png`,
      ),
    ]),
  ) as CharacterAssetConfig["animations"][number]["frames"];
}
