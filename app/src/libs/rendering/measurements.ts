/** Renderer-neutral samples. Intervals measure pacing; work measures CPU submission. */
export const summarizeSamples = (samples: readonly number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, sample) => total + sample, 0);
  const percentile = (fraction: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  return {
    count: sorted.length,
    mean: sorted.length ? sum / sorted.length : null,
    median: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    min: sorted[0] ?? null,
    max: sorted.at(-1) ?? null,
  };
};

export const createFrameMeasurements = () => {
  const intervals: number[] = [];
  const work: number[] = [];
  const stages = new Map<string, number[]>();
  const counters = new Map<string, number[]>();
  const invalidReasons = new Set<string>();
  let previousStart: number | null = null;
  let frameStart: number | null = null;

  const record = (target: Map<string, number[]>, name: string, value: number) => {
    if (!Number.isFinite(value) || value < 0) {
      invalidReasons.add(`Invalid sample for ${name}`);
      return;
    }
    const samples = target.get(name) ?? [];
    samples.push(value);
    target.set(name, samples);
  };

  return {
    begin: (now: number) => {
      if (frameStart !== null)
        invalidReasons.add("Frame began before the previous ended");
      if (previousStart !== null) {
        const interval = now - previousStart;
        if (Number.isFinite(interval) && interval > 0) intervals.push(interval);
        else invalidReasons.add("Non-increasing frame timestamp");
      }
      previousStart = now;
      frameStart = now;
    },
    end: (now: number) => {
      if (frameStart === null) return;
      const duration = now - frameStart;
      if (Number.isFinite(duration) && duration >= 0) work.push(duration);
      else invalidReasons.add("Invalid CPU frame duration");
      frameStart = null;
    },
    stage: (name: string, durationMs: number) => record(stages, name, durationMs),
    counter: (name: string, value: number) => record(counters, name, value),
    invalidate: (reason: string) => invalidReasons.add(reason),
    snapshot: () => {
      const intervalMs = summarizeSamples(intervals);
      const reasons = [...invalidReasons];
      if (!intervals.length) reasons.push("No measured frame intervals");
      if (frameStart !== null) reasons.push("Capture ended during a frame");
      return {
        valid: reasons.length === 0,
        invalidReasons: reasons,
        frameIntervalMs: intervalMs,
        cpuFrameMs: summarizeSamples(work),
        achievedFps:
          intervalMs.mean !== null && intervalMs.mean > 0
            ? 1000 / intervalMs.mean
            : null,
        framesOver33Ms: intervals.filter((value) => value > 33).length,
        framesOver50Ms: intervals.filter((value) => value > 50).length,
        stagesMs: Object.fromEntries(
          [...stages].map(([name, samples]) => [name, summarizeSamples(samples)]),
        ),
        counters: Object.fromEntries(
          [...counters].map(([name, samples]) => [name, summarizeSamples(samples)]),
        ),
        raw: {
          frameIntervalMs: [...intervals],
          cpuFrameMs: [...work],
          stagesMs: Object.fromEntries(
            [...stages].map(([key, values]) => [key, [...values]]),
          ),
          counters: Object.fromEntries(
            [...counters].map(([key, values]) => [key, [...values]]),
          ),
        },
      };
    },
  };
};

export type FrameMeasurements = ReturnType<typeof createFrameMeasurements>;
export type FrameMeasurementResult = ReturnType<FrameMeasurements["snapshot"]>;
