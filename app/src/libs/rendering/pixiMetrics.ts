import type { TextureSource, WebGLRenderer } from "pixi.js";
import { recordRenderCounter } from "@/libs/rendering/browserMetrics";

/**
 * With ?renderMetrics, wraps GL submissions for draw/triangle counts (not GPU time).
 * Reset/record per frame; dispose restores the renderer's original GL methods.
 */
export const createPixiMetrics = (renderer: WebGLRenderer) => {
  if (!new URLSearchParams(location.search).has("renderMetrics")) return null;
  const gl = renderer.gl;
  let calls = 0,
    triangles = 0;
  const restore: (() => void)[] = [];
  const count = (mode: number, vertices: number, instances = 1) => {
    calls++;
    triangles +=
      (mode === gl.TRIANGLES
        ? Math.floor(vertices / 3)
        : mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN
          ? Math.max(0, vertices - 2)
          : 0) * instances;
  };
  const arrays = gl.drawArrays,
    elements = gl.drawElements,
    arraysInstanced = gl.drawArraysInstanced,
    elementsInstanced = gl.drawElementsInstanced;
  gl.drawArrays = (mode, first, length) => {
    count(mode, length);
    arrays.call(gl, mode, first, length);
  };
  gl.drawElements = (mode, length, type, offset) => {
    count(mode, length);
    elements.call(gl, mode, length, type, offset);
  };
  if (arraysInstanced)
    gl.drawArraysInstanced = (mode, first, length, instances) => {
      count(mode, length, instances);
      arraysInstanced.call(gl, mode, first, length, instances);
    };
  if (elementsInstanced)
    gl.drawElementsInstanced = (mode, length, type, offset, instances) => {
      count(mode, length, instances);
      elementsInstanced.call(gl, mode, length, type, offset, instances);
    };
  restore.push(() => {
    gl.drawArrays = arrays;
    gl.drawElements = elements;
    gl.drawArraysInstanced = arraysInstanced;
    gl.drawElementsInstanced = elementsInstanced;
  });
  // Pixi 8.22 tracks uploaded sources and geometries in nullable GC-managed hashes.
  const textures = () =>
    Object.values(
      (
        renderer.texture as unknown as {
          _managedTextures: { items: Record<number, TextureSource | null> };
        }
      )._managedTextures.items,
    ).filter((source) => source !== null);
  return {
    reset: () => {
      calls = 0;
      triangles = 0;
    },
    record: () => {
      recordRenderCounter("drawCalls", calls);
      recordRenderCounter("triangles", triangles);
      recordRenderCounter("textures", textures().length);
      recordRenderCounter(
        "geometries",
        Object.values(renderer.geometry._managedGeometries.items).filter(Boolean)
          .length,
      );
    },
    dispose: () => {
      for (const undo of restore) undo();
    },
  };
};
