import {
  BufferImageSource,
  Container,
  Geometry,
  Mesh,
  Shader,
  State,
  Texture,
} from "pixi.js";
import { linearRenderColor } from "@/libs/rendering/color";
import type { GameRenderer } from "@/libs/rendering/runtime";
import {
  displayColorShader,
  project2DShader,
  waterUVShader,
} from "@/libs/rendering/shaders";
import type { HexTerrainData } from "@/libs/rendering/terrainData";

/**
 * Owns meshes/shaders for immutable CPU terrain data. Resolves after texture attempts;
 * missing optional images retain tinted faces, while cancellation rejects.
 * setTints replaces the overlay from original colors without mutating data.
 */
export const createHexTerrain = async (
  game: GameRenderer,
  data: HexTerrainData,
  showBoundary = true,
) => {
  const images = await Promise.all(
    data.batches.map((batch) =>
      batch.texture
        ? game.assets.texture(batch.texture).catch((error: unknown) => {
            if (
              game.signal.aborted ||
              game.isDisposed() ||
              (error instanceof Error && error.name === "AbortError")
            )
              throw error;
            console.warn("Terrain texture unavailable", error);
            return null;
          })
        : Promise.resolve(null),
    ),
  );
  if (game.signal.aborted || game.isDisposed())
    throw new DOMException("Terrain cancelled", "AbortError");
  const container = new Container();
  const geometries: Geometry[] = [],
    shaders: Shader[] = [];
  const noise = createNoiseTexture();
  const recolor: ((tints: ReadonlyMap<string, TerrainTint>) => void)[] = [];
  let disposed = false;
  const own = (geometry: Geometry, shader: Shader, state = State.for2d()) => {
    geometries.push(geometry);
    shaders.push(shader);
    container.addChild(new Mesh({ geometry, shader, state }));
  };
  const colorMesh = (
    positions: Float32Array,
    hex: string,
    alpha: number,
    lines: boolean,
  ) => {
    if (!positions.length) return;
    const color = linearRenderColor(hex);
    const geometry = new Geometry({
      attributes: { aPosition: { buffer: positions, format: "float32x2", stride: 8 } },
      topology: lines ? "line-list" : "triangle-list",
    });
    const shader = Shader.from({
      gl: {
        vertex: `precision highp float; attribute vec2 aPosition; ${project2DShader} void main() { gl_Position = project2D(aPosition); }`,
        fragment: `precision mediump float; uniform vec4 uFill; ${displayColorShader} void main() { gl_FragColor = vec4(displayColor(uFill.rgb) * uFill.a, uFill.a); }`,
      },
      resources: {
        fill: {
          uFill: {
            value: new Float32Array([color.r, color.g, color.b, alpha]),
            type: "vec4<f32>",
          },
        },
      },
    });
    own(geometry, shader);
  };
  colorMesh(data.ground, "#696969", 1, false);
  data.batches.forEach((batch, index) => {
    const colors = new Float32Array(batch.colors);
    const geometry = new Geometry({
      attributes: {
        aPosition: { buffer: batch.positions, format: "float32x2", stride: 8 },
        aUV: { buffer: batch.uvs, format: "float32x2", stride: 8 },
        aTint: { buffer: colors, format: "float32x3", stride: 12 },
        aRawTint: { buffer: batch.rawColors, format: "unorm8x4", stride: 4 },
        aWave: { buffer: batch.waves, format: "float32", stride: 4 },
      },
    });
    const shader = Shader.from({
      gl: {
        vertex: `precision highp float;
attribute vec2 aPosition; attribute vec2 aUV; attribute vec3 aTint; attribute vec4 aRawTint; attribute float aWave;
varying vec2 vUV; varying vec3 vTint; varying vec3 vRawTint; varying float vWave;
${project2DShader}
void main() { vUV = aUV; vTint = aTint; vRawTint = aRawTint.rgb; vWave = aWave; gl_Position = project2D(aPosition); }`,
        fragment: `precision mediump float;
varying vec2 vUV; varying vec3 vTint; varying vec3 vRawTint; varying float vWave;
uniform sampler2D uTexture; uniform float uKind; uniform float uTime;
${displayColorShader}
${waterUVShader}
void main() {
  vec2 uv = vWave >= 0.0 ? waterUV(vUV, uTime + vWave) : vUV;
  uv = vec2(fract(uv.x), 1.0 - fract(uv.y));
  vec3 color = vTint;
  if (uKind > 1.5) color *= linearColor(texture2D(uTexture, uv).rgb);
  else if (uKind > 0.5) color *= clamp(vRawTint + texture2D(uTexture, uv).r - 16.0 / 255.0, 0.0, 1.0);
  gl_FragColor = vec4(displayColor(color), 1.0);
}`,
      },
      resources: {
        animation: game.animation,
        uTexture: (images[index] ?? (batch.kind === "noise" ? noise : Texture.WHITE))
          .source,
        look: {
          uKind: {
            value: batch.kind === "image" ? 2 : batch.kind === "noise" ? 1 : 0,
            type: "f32",
          },
        },
      },
    });
    recolor.push((tints) => {
      colors.set(batch.colors);
      for (const tile of batch.tiles) {
        const tint = tints.get(tile.key);
        if (!tint) continue;
        const color = linearRenderColor(tint.color);
        for (let vertex = tile.start; vertex < tile.start + tile.count; vertex++) {
          for (let channel = 0; channel < 3; channel++) {
            const index = vertex * 3 + channel;
            const value = channel === 0 ? color.r : channel === 1 ? color.g : color.b;
            colors[index] =
              (batch.colors[index] ?? 0) * (1 - tint.strength) + value * tint.strength;
          }
        }
      }
      geometry.getBuffer("aTint").update();
    });
    const state = new State();
    state.blend = false;
    own(geometry, shader, state);
  });
  colorMesh(data.edges, "#555555", 0.25, true);
  if (showBoundary) colorMesh(data.boundary, "#ffc23e", 0.85, true);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!container.destroyed) container.destroy({ children: true });
    for (const geometry of geometries) geometry.destroy(true);
    for (const shader of shaders) shader.destroy();
    noise.destroy(true);
  };
  game.own(dispose);
  return {
    container,
    dispose,
    isAnimated: data.animatedTiles > 0,
    setTints: (tints: ReadonlyMap<string, TerrainTint>) => {
      for (const update of recolor) update(tints);
    },
  };
};

const createNoiseTexture = () => {
  const pixels = new Uint8Array(64 * 64 * 4);
  let state = 0x93a41;
  for (let index = 0; index < pixels.length; index += 4) {
    state = Math.imul(state ^ (state >>> 15), 0x21f0aaad);
    const noise = state >>> 27;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = noise;
    pixels[index + 3] = 255;
  }
  return new Texture({
    source: new BufferImageSource({
      resource: pixels,
      width: 64,
      height: 64,
      format: "rgba8unorm",
      scaleMode: "linear",
    }),
  });
};

/** Linear-color blend toward color; callers supply strength in [0, 1]. */
export type TerrainTint = { color: string; strength: number };
