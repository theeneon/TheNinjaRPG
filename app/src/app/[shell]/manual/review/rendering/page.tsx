"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import { runSpriteBenchmark } from "@/libs/threejs/benchmark";

/** Public, local-data-only fixtures so a device run does not mutate a game account. */
export default function RenderingBenchmarkPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const runningRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"static" | "moving" | "animated">("moving");
  const [count, setCount] = useState(500);

  useEffect(() => {
    const controller = new AbortController();
    window.tnrRenderingBenchmark = {
      run: async (options) => {
        if (!mountRef.current) throw new Error("Benchmark canvas is not mounted");
        if (runningRef.current) throw new Error("A benchmark is already running");
        runningRef.current = true;
        setIsRunning(true);
        setError(null);
        try {
          const measured = await runSpriteBenchmark(
            mountRef.current,
            options,
            controller.signal,
          );
          if (!controller.signal.aborted) setResult(measured);
          return measured;
        } catch (cause) {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : "Benchmark failed");
          throw cause;
        } finally {
          runningRef.current = false;
          if (!controller.signal.aborted) setIsRunning(false);
        }
      },
    };
    return () => {
      controller.abort(new Error("Benchmark page unmounted"));
      delete window.tnrRenderingBenchmark;
    };
  }, []);

  const run = async () => {
    try {
      await window.tnrRenderingBenchmark?.run({
        revision: "manual-run",
        deviceLabel: "Unspecified device",
        fixture: `sprites-${kind}-${count}`,
        kind,
        count,
      });
    } catch {
      // The runner displays the failure and clears pending state; another run is allowed.
    }
  };

  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rendering-${result.renderer}-${result.options.kind}-${result.options.count}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <ContentBox
      title="Rendering measurements"
      subtitle="Repeatable sprite and animation workloads"
    >
      <p className="my-3 max-w-prose text-sm">
        Each run warms up for 15 seconds, then measures for 60 seconds. Keep this page
        visible. Results include frame pacing, CPU stages, draw calls and raw samples; a
        synthetic workload does not establish gameplay or old-phone performance.
      </p>
      <div className="my-3 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          Workload
          <select
            className="bg-background ml-2 rounded border p-2"
            value={kind}
            disabled={isRunning}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="static">Static sprites</option>
            <option value="moving">Moving and sorted sprites</option>
            <option value="animated">Animated sprites</option>
          </select>
        </label>
        <label className="text-sm">
          Sprites
          <select
            className="bg-background ml-2 rounded border p-2"
            value={count}
            disabled={isRunning}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {[25, 100, 500, 1000, 5000].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={isRunning} onClick={() => void run()}>
          {isRunning ? "Measuring…" : "Run measurement"}
        </Button>
        <Button variant="outline" disabled={!result || isRunning} onClick={download}>
          Download result
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive my-3">
          {error}
        </p>
      )}
      <div
        ref={mountRef}
        className="min-h-24 max-w-full overflow-hidden rounded border"
      />
      {result && (
        <p role="status" className="my-3 text-sm">
          {result.result.valid
            ? "Valid capture"
            : `Invalid capture: ${result.result.invalidReasons.join(", ")}`}
          {" · "}
          {result.result.achievedFps?.toFixed(1)} FPS
          {" · "}p95 frame {result.result.frameIntervalMs.p95?.toFixed(2)} ms
          {" · "}p95 CPU {result.result.cpuFrameMs.p95?.toFixed(2)} ms
        </p>
      )}
    </ContentBox>
  );
}

type BenchmarkResult = Awaited<ReturnType<typeof runSpriteBenchmark>>;

declare global {
  interface Window {
    tnrRenderingBenchmark?: { run: (options: unknown) => Promise<BenchmarkResult> };
  }
}
