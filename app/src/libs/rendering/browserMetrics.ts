import { createFrameMeasurements } from "@/libs/rendering/measurements";
import {
  renderCaptureSchema,
  renderSceneSchema,
} from "@/validators/renderingBenchmark";

const sceneCanvases = new Map<
  string,
  { canvas: HTMLCanvasElement; renderer: "three" | "pixi" }
>();

/** Registers the current canvas for a scene; cleanup cannot unregister its later replacement. */
export const registerRenderCanvas = (
  scene: string,
  canvas: HTMLCanvasElement,
  renderer: "three" | "pixi" = "pixi",
) => {
  sceneCanvases.set(scene, { canvas, renderer });
  return () => {
    if (sceneCanvases.get(scene)?.canvas === canvas) sceneCanvases.delete(scene);
  };
};

const canvasIsVisible = (canvas: HTMLCanvasElement) => {
  const bounds = canvas.getBoundingClientRect();
  return (
    canvas.isConnected &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.bottom > 0 &&
    bounds.right > 0 &&
    bounds.top < innerHeight &&
    bounds.left < innerWidth
  );
};

const canvasDimensions = (canvas: HTMLCanvasElement) => ({
  width: canvas.width,
  height: canvas.height,
  cssWidth: canvas.getBoundingClientRect().width,
  cssHeight: canvas.getBoundingClientRect().height,
});

/**
 * Installs the browser capture API only with ?renderMetrics. One timed capture runs
 * at a time; warmup is excluded and visibility/size/context changes invalidate results.
 */
export const installRenderCapture = () => {
  if (
    typeof window === "undefined" ||
    !new URLSearchParams(window.location.search).has("renderMetrics")
  )
    return;
  window.tnrRenderMeasurements ??= {
    start: (scene, input) => {
      if (capture) throw new Error("A render measurement is already running");
      renderSceneSchema.parse(scene);
      const options = renderCaptureSchema.parse(input);
      const registered = sceneCanvases.get(scene);
      const canvas = registered?.canvas;
      if (!registered || !canvas || !canvasIsVisible(canvas)) {
        throw new Error(`The ${scene} canvas is not visible and ready`);
      }
      const dimensions = canvasDimensions(canvas);
      const environment = { ...captureRenderEnvironment(), canvas: dimensions };
      const startedAt = performance.now();
      const measurements = createFrameMeasurements();
      const onVisibility = () => {
        if (document.hidden)
          measurements.invalidate("Document was hidden during capture");
      };
      document.addEventListener("visibilitychange", onVisibility);
      const onScroll = () => {
        if (!canvasIsVisible(canvas))
          measurements.invalidate("Canvas left the viewport during capture");
      };
      const onResize = () => measurements.invalidate("Viewport resized during capture");
      window.addEventListener("scroll", onScroll, { passive: true, capture: true });
      window.addEventListener("resize", onResize);
      const onContextLoss = () => measurements.invalidate("WebGL context was lost");
      canvas.addEventListener("webglcontextlost", onContextLoss);
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
          window.removeEventListener("scroll", onScroll, true);
          window.removeEventListener("resize", onResize);
          onScroll();
          canvas.removeEventListener("webglcontextlost", onContextLoss);
          if (JSON.stringify(dimensions) !== JSON.stringify(canvasDimensions(canvas))) {
            measurements.invalidate("Canvas dimensions changed during capture");
          }
          if (capture === current) capture = null;
          resolve({
            schemaVersion: 1,
            renderer: registered.renderer,
            scene,
            options,
            environment,
            finalEnvironment: captureRenderEnvironment(),
            result: measurements.snapshot(options.scenario.renderMode === "idle"),
          });
        }, options.warmupMs + options.durationMs);
      });
    },
  };
};

/** Paired with endRenderMeasurement around submission; no-op outside this scene's capture window. */
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

/** During an open frame, returns a closure recording CPU stage milliseconds; otherwise undefined. */
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
