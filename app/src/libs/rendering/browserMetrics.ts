import { createFrameMeasurements } from "@/libs/rendering/measurements";
import { renderCaptureSchema } from "@/validators/renderingBenchmark";

/** Opt-in capture is available in production without enabling dev FPS panels or logs. */
export const installRenderCapture = () => {
  if (
    typeof window === "undefined" ||
    !new URLSearchParams(window.location.search).has("renderMetrics")
  )
    return;
  window.tnrRenderMeasurements ??= {
    start: (scene, input) => {
      if (capture) throw new Error("A render measurement is already running");
      const options = renderCaptureSchema.parse(input);
      const startedAt = performance.now();
      const measurements = createFrameMeasurements();
      const onVisibility = () => {
        if (document.hidden)
          measurements.invalidate("Document was hidden during capture");
      };
      document.addEventListener("visibilitychange", onVisibility);
      if (document.hidden) onVisibility();
      const current = {
        scene,
        startedAt,
        options,
        measurements,
        onVisibility,
        frameOpen: false,
      };
      capture = current;
      return new Promise((resolve) => {
        setTimeout(() => {
          document.removeEventListener("visibilitychange", onVisibility);
          if (capture === current) capture = null;
          resolve({
            schemaVersion: 1,
            renderer: "three",
            scene,
            options,
            environment: captureRenderEnvironment(),
            result: measurements.snapshot(),
          });
        }, options.warmupMs + options.durationMs);
      });
    },
  };
};

export const beginRenderMeasurement = (scene: string) => {
  if (!capture || capture.scene !== scene) return;
  const now = performance.now();
  const elapsed = now - capture.startedAt - capture.options.warmupMs;
  if (elapsed < 0 || elapsed >= capture.options.durationMs) return;
  capture.frameOpen = true;
  capture.measurements.begin(now);
};

export const endRenderMeasurement = (scene: string) => {
  if (capture?.scene !== scene || !capture.frameOpen) return;
  capture.measurements.end(performance.now());
  capture.frameOpen = false;
};

export const markRenderStage = (name: string) => {
  const current = capture;
  if (!current?.frameOpen) {
    return undefined;
  }
  const startedAt = performance.now();
  return () => current.measurements.stage(name, performance.now() - startedAt);
};

export const recordRenderCounter = (name: string, value: number) => {
  if (!capture?.frameOpen) return;
  capture.measurements.counter(name, value);
};

export const invalidateRenderMeasurement = (scene: string, reason: string) => {
  if (capture?.scene === scene) capture.measurements.invalidate(reason);
};

export const captureRenderEnvironment = () => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
    .memory;
  return {
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    logicalProcessors: navigator.hardwareConcurrency,
    deviceMemoryGiB:
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    jsHeapBytes: memory?.usedJSHeapSize ?? null,
    buildMode: process.env.NODE_ENV,
    capturedAt: new Date().toISOString(),
  };
};

let capture: {
  scene: string;
  startedAt: number;
  options: ReturnType<typeof renderCaptureSchema.parse>;
  measurements: ReturnType<typeof createFrameMeasurements>;
  onVisibility: () => void;
  frameOpen: boolean;
} | null = null;

declare global {
  interface Window {
    tnrRenderMeasurements?: {
      start: (scene: string, input: unknown) => Promise<unknown>;
    };
  }
}
