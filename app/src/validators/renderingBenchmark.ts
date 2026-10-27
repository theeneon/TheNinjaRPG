import { z } from "zod";

export const renderSceneSchema = z.enum([
  "globe",
  "sector",
  "combat",
  "farm",
  "towerDefense",
]);

/** Shared by actual gameplay capture and comparison automation. */
export const renderCaptureSchema = z.object({
  revision: z.string().min(1).max(100),
  deviceLabel: z.string().min(1).max(200),
  fixture: z.string().min(1).max(200),
  warmupMs: z.number().int().min(0).max(120_000).default(15_000),
  durationMs: z.number().int().min(100).max(120_000).default(60_000),
  run: z.number().int().min(1).max(100).default(1),
  simulated: z.boolean().default(false),
  cpuThrottlingRate: z.number().min(1).max(20).default(1),
  networkProfile: z
    .enum(["unthrottled", "Slow 3G", "Fast 3G", "Slow 4G", "Fast 4G"])
    .default("unthrottled"),
  scenario: z
    .record(
      z.string(),
      z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    )
    .default({}),
});

export type RenderCaptureOptions = z.infer<typeof renderCaptureSchema>;

const sampleList = z.array(z.number().finite().nonnegative());
export const renderMeasurementResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    renderer: z.enum(["three", "pixi"]),
    scene: renderSceneSchema,
    options: renderCaptureSchema,
    environment: z
      .object({
        userAgent: z.string(),
        viewport: z.object({ width: z.number(), height: z.number() }),
        devicePixelRatio: z.number(),
        buildMode: z.string(),
        canvas: z.object({
          width: z.number(),
          height: z.number(),
          cssWidth: z.number(),
          cssHeight: z.number(),
        }),
      })
      .loose(),
    result: z.object({
      valid: z.boolean(),
      invalidReasons: z.array(z.string()),
      raw: z.object({
        frameIntervalMs: z.array(z.number().finite().positive()),
        cpuFrameMs: sampleList,
        stagesMs: z.record(z.string(), sampleList),
        counters: z.record(z.string(), sampleList),
      }),
    }),
  })
  .loose();

export type RenderMeasurementResult = z.infer<typeof renderMeasurementResultSchema>;
