import { describe, expect, it } from "bun:test";
import { createMapControls } from "@/libs/rendering/mapControls";
import type { GameRenderer } from "@/libs/rendering/runtime";
import { ensureDom } from "../../setup-dom.mjs";

ensureDom();
const setup = () => {
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 390, 390);
  const listeners = new window.AbortController();
  const taps: number[][] = [], zooms: number[] = [];
  let enabled = true;
  createMapControls({ canvas, renderer: { width: 390, height: 390 }, listen: (type: string, callback: EventListener) => canvas.addEventListener(type, callback, { signal: listeners.signal }) } as GameRenderer, {
    enabled: () => enabled, tap: (x, y) => taps.push([x, y]), zoom: (factor) => zooms.push(factor),
  });
  const event = (type: string, id: number, x: number, y: number) => {
    const pointer = new window.MouseEvent(type, { clientX: x, clientY: y, button: 0 });
    Object.defineProperties(pointer, { pointerId: { value: id }, pointerType: { value: "touch" } });
    canvas.dispatchEvent(pointer);
  };
  return { canvas, taps, zooms, event, disable: () => { enabled = false; }, dispose: () => listeners.abort() };
};

describe("map gesture ownership", () => {
  it("dispatches taps but never dispatches drags that return to their start", () => {
    const scene = setup();
    try {
      scene.event("pointerdown", 1, 100, 100); scene.event("pointerup", 1, 102, 102);
      expect(scene.taps).toEqual([[102, 102]]);
      scene.event("pointerdown", 2, 100, 100); scene.event("pointermove", 2, 150, 100);
      scene.event("pointermove", 2, 100, 100); scene.event("pointerup", 2, 100, 100);
      expect(scene.taps).toHaveLength(1);
    } finally { scene.dispose(); }
  });
  it("zooms pinches without a trailing tap and cancels interrupted touches", () => {
    const scene = setup();
    try {
      scene.event("pointerdown", 1, 100, 100); scene.event("pointerdown", 2, 200, 100);
      scene.event("pointermove", 2, 250, 100); scene.event("pointerup", 2, 250, 100); scene.event("pointerup", 1, 100, 100);
      expect(scene.zooms).toEqual([1.5]); expect(scene.taps).toEqual([]);
      scene.event("pointerdown", 3, 100, 100); scene.event("pointercancel", 3, 100, 100); scene.event("pointerup", 3, 100, 100);
      expect(scene.taps).toEqual([]);
    } finally { scene.dispose(); }
  });
  it("owns wheel zoom while enabled and ignores gestures behind the scouting panel", () => {
    const scene = setup();
    try {
      const wheel = new window.WheelEvent("wheel", { deltaY: -100, cancelable: true });
      scene.canvas.dispatchEvent(wheel);
      expect(wheel.defaultPrevented).toBe(true); expect(scene.zooms[0]).toBeGreaterThan(1);
      scene.disable();
      scene.event("pointerdown", 1, 100, 100); scene.event("pointerup", 1, 100, 100);
      expect(scene.taps).toEqual([]);
    } finally { scene.dispose(); }
  });
});
