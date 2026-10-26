import { expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { Grid, rectangle } from "honeycomb-grid";
import {
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
} from "three";
import { defineHex } from "@/libs/hexgrid";
import {
  createSectorRenderCache,
  type SectorRenderEntry,
} from "@/libs/threejs/sectorRenderCache";
import { cleanUp } from "@/libs/threejs/util";

// Execute the actual final teardown and sector release, as in the combat
// lifecycle tests, without mounting the component's unrelated UI and WebGL.
const source = readFileSync(new URL("../../src/layout/Sector.tsx", import.meta.url), "utf8");
const sourceBetween = (start: string, end: string) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Sector lifecycle source missing: ${start}`);
  return source.slice(from, to);
};
const transpiler = new (require("bun").Transpiler)({ loader: "ts" }) as {
  transformSync(source: string): string;
};
const teardown = new Function("scope", `with (scope) { ${transpiler.transformSync([
  sourceBetween("  const disposeSectorRender = (", "  /** Rebuild the render-loop collections"),
  sourceBetween("        profiler.reset();", "        // Note: Do NOT call clearTextureCaches()"),
].join("\n"))} }`) as (scope: object) => void;

// Use Three.js's real self-removing renderer listener. Renderer.dispose does
// not remove it; only a material's dispose event releases this closure.
const rendererSource = readFileSync(new URL("../../node_modules/three/src/renderers/WebGLRenderer.js", import.meta.url), "utf8");
const listenerStart = rendererSource.indexOf("function onMaterialDispose( event )");
const listenerEnd = rendererSource.indexOf("// Buffer deallocation", listenerStart);
if (listenerStart < 0 || listenerEnd < 0) throw new Error("Three.js material disposal listener is missing");
const createRendererListener = new Function("deallocateMaterial", `${rendererSource.slice(listenerStart, listenerEnd)}; return onMaterialDispose;`) as (
  deallocateMaterial: (material: Material) => void,
) => (event: { target: Material }) => void;

it("releases renderer material listeners on every teardown while retaining reusable static content", () => {
  const cache = createSectorRenderCache();
  const grid = new Grid(defineHex(), rectangle({ width: 2, height: 2 }));
  const interaction = new Group();
  const assets = new Group();
  const wrapper = new Group();
  const palette = new MeshBasicMaterial();
  const wind = new SpriteMaterial();
  const sharedMaterials = [palette, wind];
  for (const material of sharedMaterials) material.userData.shared = true;
  const terrain = new Mesh(new PlaneGeometry(1, 1), palette);
  assets.add(new Sprite(wind));
  wrapper.add(terrain, interaction, assets);
  const render: SectorRenderEntry = {
    wrapper, grid, interaction, assets, animatedMaterials: [], renderKey: "sector",
  };
  const positions = terrain.geometry.getAttribute("position").array;
  const retiredListeners: ReturnType<typeof createRendererListener>[] = [];

  try {
    for (let mount = 0; mount < 3; mount++) {
      if (mount > 0) expect(cache.take("sector", 1)).toBe(render);
      const scene = new Scene();
      const worldRoot = new Group();
      const groupUsers = new Group();
      const groupQuest = new Group();
      const user = new Sprite(new SpriteMaterial());
      groupUsers.add(user);
      wrapper.add(groupUsers, groupQuest);
      worldRoot.add(wrapper);
      scene.add(worldRoot);
      const registry = {
        worldRoot, groupUsers, groupQuest,
        entries: new Map([[1, render]]),
        wrappers: new Map([[1, wrapper]]),
        grids: new Map([[1, grid]]),
      };
      const deallocateMaterial = vi.fn();
      const listener = createRendererListener(deallocateMaterial);
      retiredListeners.push(listener);
      for (const material of sharedMaterials) material.addEventListener("dispose", listener);
      const renderer = {
        dispose: vi.fn(() => {
          for (const material of sharedMaterials) {
            expect(material.hasEventListener("dispose", listener)).toBe(false);
          }
        }),
        forceContextLoss: vi.fn(),
      };
      const disposeUser = vi.fn();
      user.material.addEventListener("dispose", disposeUser);

      teardown({
        registry, worldRegistryRef: { current: registry },
        sectorRenderCache: cache, scene, renderer, cleanUp,
        profiler: { reset() {} },
      });

      expect(deallocateMaterial).toHaveBeenCalledTimes(2);
      expect(renderer.dispose).toHaveBeenCalledTimes(1);
      expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
      expect(disposeUser).toHaveBeenCalledTimes(1);
      expect(registry.entries.size).toBe(0);
      expect(wrapper.parent).toBeNull();
      expect(wrapper.children).not.toContain(groupUsers);
      expect(wrapper.children).not.toContain(groupQuest);
      expect(terrain.geometry.getAttribute("position").array).toBe(positions);
      expect(positions.length).toBeGreaterThan(0);
      expect(terrain.material).toBe(palette);
      expect((assets.children[0] as Sprite).material).toBe(wind);
      for (const retired of retiredListeners) {
        for (const material of sharedMaterials) {
          expect(material.hasEventListener("dispose", retired)).toBe(false);
        }
      }
    }
  } finally {
    cache.clear();
  }
});
