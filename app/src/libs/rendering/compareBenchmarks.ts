import { summarizeSamples } from "@/libs/rendering/measurements";
import {
  type RenderMeasurementResult,
  renderMeasurementResultSchema,
} from "@/validators/renderingBenchmark";

/** Match the workload and environment, not just a friendly fixture name. */
const comparisonKey = (run: RenderMeasurementResult) => {
  const { revision: _revision, run: _run, ...options } = run.options;
  return JSON.stringify([
    run.scene,
    options,
    run.environment.userAgent,
    run.environment.viewport,
    run.environment.devicePixelRatio,
    run.environment.buildMode,
    run.environment.canvas,
  ]);
};

export const compareRenderingBenchmarks = (
  beforeInput: unknown[],
  afterInput: unknown[],
) => {
  const before = beforeInput.map((run) => renderMeasurementResultSchema.parse(run));
  const after = afterInput.map((run) => renderMeasurementResultSchema.parse(run));
  const keys = new Set([...before, ...after].map(comparisonKey));
  const groups = [...keys].map((key) => {
    const baseline = before.filter((run) => comparisonKey(run) === key);
    const replacement = after.filter((run) => comparisonKey(run) === key);
    const example = baseline[0] ?? replacement[0];
    if (!example) throw new Error("Empty benchmark comparison");
    const issues: string[] = [];
    const valid = (runs: RenderMeasurementResult[], name: string) =>
      runs.filter((run) => {
        if (
          !run.result.valid ||
          !run.result.raw.frameIntervalMs.length ||
          !run.result.raw.cpuFrameMs.length
        ) {
          issues.push(
            `${name} run ${run.options.run} is invalid: ${run.result.invalidReasons.join(", ") || "no measured frames"}`,
          );
          return false;
        }
        return true;
      });
    const beforeRuns = valid(baseline, "Before");
    const afterRuns = valid(replacement, "After");
    if (!baseline.length || !replacement.length)
      issues.push("No equal-workload/environment counterpart");
    for (const [name, runs] of [
      ["Before", beforeRuns],
      ["After", afterRuns],
    ] as const) {
      if (runs.length < 5) issues.push(`${name} has fewer than five valid runs`);
      if (new Set(runs.map((run) => run.options.run)).size !== runs.length)
        issues.push(`${name} contains duplicate run numbers`);
      if (new Set(runs.map((run) => run.options.revision)).size > 1)
        issues.push(`${name} mixes source revisions`);
      if (new Set(runs.map((run) => run.renderer)).size > 1)
        issues.push(`${name} mixes renderers`);
    }
    if (example.environment.buildMode !== "production")
      issues.push("Development-mode measurements are exploratory");
    const limitations = example.options.simulated
      ? ["Simulated environment; not physical old-phone evidence"]
      : [];

    const metric = (
      name: string,
      read: (run: RenderMeasurementResult) => number | null,
      lowerIsBetter: boolean,
    ) => {
      const summarizeRuns = (runs: RenderMeasurementResult[]) =>
        summarizeSamples(runs.map(read).filter((v): v is number => v !== null));
      const previous = summarizeRuns(beforeRuns);
      const next = summarizeRuns(afterRuns);
      const delta =
        previous.median !== null && next.median !== null
          ? next.median - previous.median
          : null;
      return {
        name,
        lowerIsBetter,
        before: previous,
        after: next,
        absoluteChange: delta,
        percentageChange:
          delta !== null && previous.median !== null && previous.median !== 0
            ? (delta / previous.median) * 100
            : null,
      };
    };
    const stages = new Set(
      [...beforeRuns, ...afterRuns].flatMap((run) =>
        Object.keys(run.result.raw.stagesMs),
      ),
    );
    const counters = new Set(
      [...beforeRuns, ...afterRuns].flatMap((run) =>
        Object.keys(run.result.raw.counters),
      ),
    );
    const metrics = [
      metric(
        "achievedFps",
        (run) => {
          const mean = summarizeSamples(run.result.raw.frameIntervalMs).mean;
          return mean ? 1000 / mean : null;
        },
        false,
      ),
      metric(
        "frameIntervalMs.p95",
        (run) => summarizeSamples(run.result.raw.frameIntervalMs).p95,
        true,
      ),
      metric(
        "frameIntervalMs.p99",
        (run) => summarizeSamples(run.result.raw.frameIntervalMs).p99,
        true,
      ),
      metric(
        "cpuFrameMs.p95",
        (run) => summarizeSamples(run.result.raw.cpuFrameMs).p95,
        true,
      ),
      ...[...stages].map((stage) =>
        metric(
          `stagesMs.${stage}.p95`,
          (run) => summarizeSamples(run.result.raw.stagesMs[stage] ?? []).p95,
          true,
        ),
      ),
      ...[...counters].map((counter) =>
        metric(
          `counters.${counter}.mean`,
          (run) => summarizeSamples(run.result.raw.counters[counter] ?? []).mean,
          true,
        ),
      ),
    ];
    if (
      metrics.some(
        (row) =>
          row.before.count !== beforeRuns.length ||
          row.after.count !== afterRuns.length,
      )
    ) {
      issues.push("A metric is missing from one or more runs");
    }
    return {
      scene: example.scene,
      fixture: example.options.fixture,
      options: example.options,
      environment: example.environment,
      beforeRevisions: [...new Set(baseline.map((run) => run.options.revision))],
      afterRevisions: [...new Set(replacement.map((run) => run.options.revision))],
      beforeRuns: beforeRuns.length,
      afterRuns: afterRuns.length,
      comparable: issues.length === 0,
      issues,
      limitations,
      metrics,
    };
  });
  return {
    schemaVersion: 1,
    comparable: groups.length > 0 && groups.every((group) => group.comparable),
    groups,
  };
};
