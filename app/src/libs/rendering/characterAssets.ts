import type { CharacterAssetConfig as DbCharacterAssetConfig } from "@/validators/towerDefense";

export interface CharacterAssetConfig extends DbCharacterAssetConfig {
  basePath?: string;
}

export const PLAYER_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/player",
  rotations: {
    north: "rotations/north.png",
    "north-east": "rotations/north-east.png",
    east: "rotations/east.png",
    "south-east": "rotations/south-east.png",
    south: "rotations/south.png",
    "south-west": "rotations/south-west.png",
    west: "rotations/west.png",
    "north-west": "rotations/north-west.png",
  },
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 100,
      loop: true,
      frames: {
        north: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "throw-object",
      state: "throw",
      frameDurationMs: 60,
      loop: false,
      frames: {
        north: Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 7 },
          (_, i) => `animations/throw-object/north-west/frame_00${i}.png`,
        ),
      },
    },
  ],
};

export const LIGHT_ENEMY_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/light_character",
  rotations: {
    north: "rotations/north.png",
    "north-east": "rotations/north-east.png",
    east: "rotations/east.png",
    "south-east": "rotations/south-east.png",
    south: "rotations/south.png",
    "south-west": "rotations/south-west.png",
    west: "rotations/west.png",
    "north-west": "rotations/north-west.png",
  },
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 120,
      loop: true,
      frames: {
        north: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "running-6-frames",
      state: "moving",
      frameDurationMs: 80,
      loop: true,
      frames: {
        north: Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 6 },
          (_, i) => `animations/running-6-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "lead-jab",
      state: "punch",
      frameDurationMs: 100,
      loop: false,
      frames: {
        north: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north-west/frame_00${i}.png`,
        ),
      },
    },
  ],
};

export const HEAVY_ENEMY_ASSET_CONFIG: CharacterAssetConfig = {
  basePath: "/towerdefence/heavy_character",
  rotations: {
    north: "rotations/north.png",
    "north-east": "rotations/north-east.png",
    east: "rotations/east.png",
    "south-east": "rotations/south-east.png",
    south: "rotations/south.png",
    "south-west": "rotations/south-west.png",
    west: "rotations/west.png",
    "north-west": "rotations/north-west.png",
  },
  animations: [
    {
      name: "fight-stance-idle-8-frames",
      state: "idle",
      frameDurationMs: 150, // Slower idle for heavy feel
      loop: true,
      frames: {
        north: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 8 },
          (_, i) => `animations/fight-stance-idle-8-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "walking-6-frames",
      state: "moving",
      frameDurationMs: 120, // Slower than light enemy's running
      loop: true,
      frames: {
        north: Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 6 },
          (_, i) => `animations/walking-6-frames/north-west/frame_00${i}.png`,
        ),
      },
    },
    {
      name: "lead-jab",
      state: "punch",
      frameDurationMs: 150, // Slower punch animation for heavy feel
      loop: false,
      frames: {
        north: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north/frame_00${i}.png`,
        ),
        "north-east": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north-east/frame_00${i}.png`,
        ),
        east: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/east/frame_00${i}.png`,
        ),
        "south-east": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south-east/frame_00${i}.png`,
        ),
        south: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south/frame_00${i}.png`,
        ),
        "south-west": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/south-west/frame_00${i}.png`,
        ),
        west: Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/west/frame_00${i}.png`,
        ),
        "north-west": Array.from(
          { length: 3 },
          (_, i) => `animations/lead-jab/north-west/frame_00${i}.png`,
        ),
      },
    },
  ],
};
