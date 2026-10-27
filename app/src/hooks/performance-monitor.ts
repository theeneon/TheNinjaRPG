import { useEffect, useRef } from "react";
import type Stats from "stats.js";
import {
  beginRenderMeasurement,
  endRenderMeasurement,
  installRenderCapture,
  invalidateRenderMeasurement,
  registerRenderCanvas,
} from "@/libs/rendering/browserMetrics";

/**
 * Development FPS panels and opt-in production measurements for a named scene.
 *
 * @param unbounded - If true, removes vsync limitation for performance testing (dev only)
 */
export const usePerformanceMonitor = (unbounded = false, scene = "scene") => {
  const releaseCanvasRef = useRef<(() => void) | null>(null);
  const statsRef = useRef<{
    fps: Stats | null;
    ms: Stats | null;
    mb: Stats | null;
  }>({
    fps: null,
    ms: null,
    mb: null,
  });

  useEffect(() => {
    installRenderCapture();
    return () => {
      invalidateRenderMeasurement(scene, "Scene unmounted during capture");
      releaseCanvasRef.current?.();
    };
  }, [scene]);

  useEffect(() => {
    // Only load Stats.js in development mode
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    let disposed = false;
    // Dynamically import Stats.js only in development
    void import("stats.js").then((module) => {
      if (disposed) return;
      const Stats = module.default;

      // Create FPS panel
      const statsFps = new Stats();
      statsFps.showPanel(0); // FPS
      statsFps.dom.style.cssText = "position:fixed;top:0;left:0;z-index:10000";
      document.body.appendChild(statsFps.dom);
      statsRef.current.fps = statsFps;

      // Create MS panel
      const statsMs = new Stats();
      statsMs.showPanel(1); // MS
      statsMs.dom.style.cssText = "position:fixed;top:0;left:80px;z-index:10000";
      document.body.appendChild(statsMs.dom);
      statsRef.current.ms = statsMs;

      // Create MB panel
      const statsMb = new Stats();
      statsMb.showPanel(2); // MB
      statsMb.dom.style.cssText = "position:fixed;top:0;left:160px;z-index:10000";
      document.body.appendChild(statsMb.dom);
      statsRef.current.mb = statsMb;
    });

    // Cleanup on unmount
    return () => {
      disposed = true;
      try {
        if (statsRef.current.fps && document.body.contains(statsRef.current.fps.dom)) {
          document.body.removeChild(statsRef.current.fps.dom);
        }
        if (statsRef.current.ms && document.body.contains(statsRef.current.ms.dom)) {
          document.body.removeChild(statsRef.current.ms.dom);
        }
        if (statsRef.current.mb && document.body.contains(statsRef.current.mb.dom)) {
          document.body.removeChild(statsRef.current.mb.dom);
        }
      } catch {
        // Ignore errors if elements are already removed
      }
      statsRef.current = { fps: null, ms: null, mb: null };
    };
  }, []);

  // Return functions to begin and end performance measurements
  const begin = () => {
    beginRenderMeasurement(scene);
    if (process.env.NODE_ENV !== "development") return;
    statsRef.current.fps?.begin();
    statsRef.current.ms?.begin();
    statsRef.current.mb?.begin();
  };

  const end = () => {
    endRenderMeasurement(scene);
    if (process.env.NODE_ENV !== "development") return;
    statsRef.current.fps?.end();
    statsRef.current.ms?.end();
    statsRef.current.mb?.end();
  };

  // Return custom requestAnimationFrame that can be unbounded for performance testing
  const requestFrame = (callback: FrameRequestCallback) => {
    if (
      process.env.NODE_ENV === "development" &&
      unbounded &&
      !window.tnrRenderMeasurements
    ) {
      // Unbounded mode: run as fast as possible without vsync
      return setTimeout(() => callback(performance.now()), 0) as unknown as number;
    }
    // Normal mode: sync with display refresh rate
    return requestAnimationFrame(callback);
  };

  const cancelFrame = (id: number) => {
    if (
      process.env.NODE_ENV === "development" &&
      unbounded &&
      !window.tnrRenderMeasurements
    ) {
      clearTimeout(id);
    } else {
      cancelAnimationFrame(id);
    }
  };

  const setCanvas = (canvas: HTMLCanvasElement) => {
    releaseCanvasRef.current?.();
    releaseCanvasRef.current = registerRenderCanvas(scene, canvas);
  };

  return { begin, end, requestFrame, cancelFrame, setCanvas, isUnbounded: unbounded };
};
