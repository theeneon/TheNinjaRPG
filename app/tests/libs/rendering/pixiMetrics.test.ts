import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { WebGLRenderer } from "pixi.js";
import * as measurements from "@/libs/rendering/browserMetrics";
import { createPixiMetrics } from "@/libs/rendering/pixiMetrics";

let originalLocation: PropertyDescriptor | undefined;
beforeEach(() => { originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location"); Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "?renderMetrics=1" } }); });
afterEach(() => { vi.restoreAllMocks(); if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation); else Reflect.deleteProperty(globalThis, "location"); });

describe("opt-in Pixi GPU counters", () => {
  it("counts actual draws and instanced triangles once and restores the GL methods", () => {
    const gl = { TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6, drawArrays: vi.fn(), drawElements: vi.fn(), drawArraysInstanced: vi.fn(), drawElementsInstanced: vi.fn() };
    const original = { ...gl }, counter = vi.spyOn(measurements, "recordRenderCounter").mockImplementation(() => {});
    const renderer = { gl, texture: { _managedTextures: { items: { 1: {}, 2: {}, 3: null } } }, geometry: { _managedGeometries: { items: { 1: {}, 2: null } } } } as unknown as WebGLRenderer;
    const metrics = createPixiMetrics(renderer)!; metrics.reset();
    gl.drawArrays(4, 0, 9); gl.drawElements(5, 5, 5123, 0); gl.drawElementsInstanced(4, 6, 5123, 0, 3);
    metrics.record();
    expect(counter.mock.calls).toEqual([["drawCalls", 3], ["triangles", 12], ["textures", 2], ["geometries", 1]]);
    expect(original.drawElementsInstanced).toHaveBeenCalledWith(4, 6, 5123, 0, 3);
    expect(original.drawElementsInstanced).toHaveBeenCalledTimes(1);
    metrics.dispose(); expect(gl.drawArrays).toBe(original.drawArrays); expect(gl.drawElementsInstanced).toBe(original.drawElementsInstanced);
  });
  it("does not instrument an ordinary user's renderer", () => {
    Object.defineProperty(globalThis, "location", { configurable: true, value: { search: "" } });
    expect(createPixiMetrics({} as WebGLRenderer)).toBeNull();
  });
});
