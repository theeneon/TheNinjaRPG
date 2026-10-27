import { describe, expect, it } from "bun:test";
import { createFrameMeasurements, summarizeSamples } from "@/libs/rendering/measurements";
import { renderCaptureSchema } from "@/validators/renderingBenchmark";

describe("render measurements", () => {
  it("uses nearest-rank percentiles and does not invent empty measurements", () => {
    expect(summarizeSamples([]).p95).toBeNull();
    expect(summarizeSamples(Array.from({ length: 100 }, (_, i) => i + 1))).toMatchObject({
      median: 50, p95: 95, p99: 99, mean: 50.5,
    });
    expect(createFrameMeasurements().snapshot().valid).toBe(false);
  });

  it("permits a deliberately idle visible scene without inventing frame intervals", () => {
    const idle = createFrameMeasurements().snapshot(true);
    expect(idle.valid).toBe(true); expect(idle.achievedFps).toBeNull();
    expect(idle.raw.cpuFrameMs).toEqual([]); expect(idle.raw.frameIntervalMs).toEqual([]);
  });

  it("separates pacing from CPU time and retains long frames", () => {
    const samples = createFrameMeasurements();
    for (const start of [0, 16, 32, 1032]) {
      samples.begin(start);
      samples.stage("animation", 1);
      samples.counter("drawCalls", 4);
      samples.end(start + 2);
    }
    const result = samples.snapshot();
    expect(result.valid).toBe(true);
    expect(result.raw.frameIntervalMs).toEqual([16, 16, 1000]);
    expect(result.cpuFrameMs.mean).toBe(2);
    expect(result.achievedFps).toBeCloseTo(3000 / 1032);
    expect(result.framesOver50Ms).toBe(1);
    expect(result.stagesMs.animation?.count).toBe(4);
  });

  it("rejects interrupted or invalid captures without silently filtering samples", () => {
    const samples = createFrameMeasurements();
    samples.begin(0);
    samples.end(1);
    samples.begin(16);
    samples.counter("textures", Number.NaN);
    samples.invalidate("Document was hidden during capture");
    const result = samples.snapshot();
    expect(result.valid).toBe(false);
    expect(result.invalidReasons).toContain("Capture ended during a frame");
    expect(result.invalidReasons).toContain("Invalid sample for textures");
    expect(result.raw.frameIntervalMs).toEqual([16]);
  });

  it("bounds external workload inputs and gives comparable protocol defaults", () => {
    const options = { revision: "baseline", deviceLabel: "test", fixture: "combat-dense" };
    expect(renderCaptureSchema.parse(options)).toMatchObject({
      warmupMs: 15_000, durationMs: 60_000, cpuThrottlingRate: 1, networkProfile: "unthrottled",
    });
    expect(renderCaptureSchema.safeParse({ ...options, cpuThrottlingRate: 0 }).success).toBe(false);
    expect(renderCaptureSchema.safeParse({ ...options, durationMs: 1e9 }).success).toBe(false);
    expect(renderCaptureSchema.safeParse({ ...options, durationMs: Infinity }).success).toBe(false);
  });
});
