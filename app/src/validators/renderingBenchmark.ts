import { z } from "zod";

/** Shared by the browser runner, scene capture API and external benchmark automation. */
export const renderCaptureSchema = z.object({
  revision: z.string().min(1).max(100),
  deviceLabel: z.string().min(1).max(200),
  fixture: z.string().min(1).max(200),
  warmupMs: z.number().int().min(0).max(120_000).default(15_000),
  durationMs: z.number().int().min(100).max(120_000).default(60_000),
  run: z.number().int().min(1).max(100).default(1),
  simulated: z.boolean().default(false),
});

export const spriteBenchmarkSchema = renderCaptureSchema.extend({
  kind: z.enum(["static", "moving", "animated"]),
  count: z.number().int().min(1).max(10_000),
  textureCount: z.number().int().min(1).max(16).default(1),
  width: z.number().int().min(128).max(2048).default(640),
  height: z.number().int().min(128).max(2048).default(480),
  resolution: z.number().min(0.5).max(2).default(1),
  antialias: z.boolean().default(false),
});

export type RenderCaptureOptions = z.infer<typeof renderCaptureSchema>;
export type SpriteBenchmarkOptions = z.infer<typeof spriteBenchmarkSchema>;
