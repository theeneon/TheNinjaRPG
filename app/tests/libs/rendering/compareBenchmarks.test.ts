import { describe, expect, it } from "bun:test";
import { compareRenderingBenchmarks } from "@/libs/rendering/compareBenchmarks";

const runs = (renderer: "three" | "pixi", cpu: number) => Array.from({ length: 5 }, (_, i) => ({
  schemaVersion: 1, scene: "combat", renderer,
  options: { revision: renderer, deviceLabel: "same-device", fixture: "combat-dense", run: i + 1 },
  environment: { userAgent: "same-browser", viewport: { width: 800, height: 600 }, devicePixelRatio: 1, buildMode: "production", canvas: { width: 800, height: 600, cssWidth: 800, cssHeight: 600 } },
  result: { valid: true, invalidReasons: [] as string[], raw: { frameIntervalMs: [16, 16, 16], cpuFrameMs: [cpu, cpu, cpu], stagesMs: { render: [cpu / 2], animation: [cpu / 2] }, counters: { drawCalls: [renderer === "three" ? 500 : 1] } } },
}));

describe("renderer benchmark comparison", () => {
  it("shows CPU headroom and raw-run spread when FPS is capped equally", () => {
    const report = compareRenderingBenchmarks(runs("three", 4), runs("pixi", 1));
    expect(report.comparable).toBe(true);
    const group = report.groups[0]!;
    expect(group.metrics.find((row) => row.name === "achievedFps")?.percentageChange).toBe(0);
    expect(group.metrics.find((row) => row.name === "cpuFrameMs.p95")).toMatchObject({ absoluteChange: -3, percentageChange: -75, before: { count: 5, min: 4, max: 4 } });
  });

  it("does not compare a reduced-resolution workload against the original", () => {
    const replacement = runs("pixi", 1).map((run) => ({ ...run, environment: { ...run.environment, canvas: { ...run.environment.canvas, width: 400, height: 300 } } }));
    const report = compareRenderingBenchmarks(runs("three", 4), replacement);
    expect(report.comparable).toBe(false);
    expect(report.groups).toHaveLength(2);
    expect(report.groups.every((group) => group.issues.includes("No equal-workload/environment counterpart"))).toBe(true);
  });

  it("keeps incomplete, hidden-tab and duplicate runs out of a release comparison", () => {
    const before = runs("three", 4);
    before[0]!.result.valid = false;
    before[0]!.result.invalidReasons.push("Document was hidden during capture");
    before[1]!.options.run = 3;
    const group = compareRenderingBenchmarks(before, runs("pixi", 1)).groups[0]!;
    expect(group.comparable).toBe(false);
    expect(group.beforeRuns).toBe(4);
    expect(group.issues.some((issue) => issue.includes("hidden"))).toBe(true);
    expect(group.issues.some((issue) => issue.includes("duplicate"))).toBe(true);
  });

  it("does not hide a metric that the replacement stopped reporting", () => {
    const after = runs("pixi", 1).map((run) => ({ ...run, result: { ...run.result, raw: { ...run.result.raw, stagesMs: {} } } }));
    const report = compareRenderingBenchmarks(runs("three", 4), after);
    expect(report.comparable).toBe(false);
    expect(report.groups[0]?.issues).toContain("A metric is missing from one or more runs");
  });

  it("retains implementation-specific diagnostics without treating them as missing shared work", () => {
    const after = runs("pixi", 1).map((run) => ({ ...run, result: { ...run.result, raw: { ...run.result.raw, stagesMs: { render: [0.5], update: [0.5] } } } }));
    const report = compareRenderingBenchmarks(runs("three", 4), after);
    expect(report.comparable).toBe(true);
    expect(report.groups[0]?.metrics.find((row) => row.name === "stagesMs.animation.p95")).toMatchObject({ role: "diagnostic", after: { count: 0 } });
  });

  it("reports stopped idle rendering as less CPU work without calling it an FPS regression", () => {
    const before = runs("three", 4).map((run) => ({ ...run, options: { ...run.options, scenario: { renderMode: "idle" } } }));
    const after = runs("pixi", 1).map((run) => ({ ...run, options: { ...run.options, scenario: { renderMode: "idle" } }, result: { ...run.result, raw: { frameIntervalMs: [], cpuFrameMs: [], stagesMs: {}, counters: { drawCalls: [] } } } }));
    const report = compareRenderingBenchmarks(before, after);
    expect(report.comparable).toBe(true);
    expect(report.groups[0]?.metrics.some((row) => row.name === "achievedFps")).toBe(false);
    expect(report.groups[0]?.metrics.find((row) => row.name === "renderCpuMsPerSecond")).toMatchObject({ after: { median: 0 }, percentageChange: -100 });
  });

  it("can compare equal simulated conditions without claiming physical phone evidence", () => {
    const simulated = (renderer: "three" | "pixi", cpu: number) => runs(renderer, cpu).map((run) => ({ ...run, options: { ...run.options, simulated: true } }));
    const report = compareRenderingBenchmarks(simulated("three", 4), simulated("pixi", 1));
    expect(report.comparable).toBe(true);
    expect(report.groups[0]?.limitations).toContain("Simulated environment; not physical old-phone evidence");
  });
});
