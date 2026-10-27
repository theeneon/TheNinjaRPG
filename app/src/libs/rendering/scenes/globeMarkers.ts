import {
  Container,
  Geometry,
  Mesh,
  Shader,
  State,
  Texture,
  type UniformGroup,
} from "pixi.js";
import { IMG_SECTOR_USER_SPRITE_MASK } from "@/drizzle/constants";
import { createSceneAssets } from "@/libs/rendering/assets";
import type { GameRenderer } from "@/libs/rendering/runtime";
import {
  GLOBE_HALF_FOV,
  type GlobeCamera,
  globeProject,
  globeRay,
  globeRayHit,
} from "@/libs/rendering/scenes/globeProjection";
import {
  globeCameraShader,
  globeOcclusionShader,
} from "@/libs/rendering/scenes/globeShaders";
import type { GlobalPoint } from "@/libs/sector-map/world-types";
import { contrastingTextColor } from "@/utils/color";

/** One small atlas batch per 64 markers, including per-pixel spherical occlusion. */
export const createGlobeMarkers = (
  game: GameRenderer,
  uniforms: UniformGroup,
  camera: GlobeCamera,
  radius: number,
) => {
  const container = new Container();
  let generation = 0;
  let assets = createSceneAssets();
  let pages: { texture: Texture; geometry: Geometry; shader: Shader }[] = [];
  let markers: GlobeMarker[] = [];
  let hoveredOwner: string | null = null;
  const clear = () => {
    for (const child of container.removeChildren()) child.destroy();
    for (const page of pages) {
      page.geometry.destroy(true);
      page.shader.destroy();
      page.texture.destroy(true);
    }
    pages = [];
    assets.dispose();
  };
  const rebuildGeometry = (page: { geometry: Geometry }, group: GlobeMarker[]) => {
    const centers: number[] = [],
      offsets: number[] = [],
      uvs: number[] = [],
      metadata: number[] = [],
      indices: number[] = [];
    for (let index = 0; index < group.length; index++) {
      const marker = group[index];
      if (!marker) continue;
      const emphasized = hoveredOwner !== null && marker.owner === hoveredOwner;
      const alpha = hoveredOwner !== null && marker.owner && !emphasized ? 0.48 : 1;
      const lift = emphasized ? 1.14 : 1;
      const size =
        marker.kind === "label"
          ? [2.5, 1]
          : marker.kind === "avatar"
            ? [1.2, 1.2]
            : [1, 1];
      const width = marker.kind === "label" ? 100 : 64,
        height = marker.kind === "label" ? 40 : 64;
      const x = (index % 8) * 128 + 2,
        y = Math.floor(index / 8) * 128 + 2;
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        centers.push(marker.point.x, marker.point.y, marker.point.z);
        offsets.push(
          ((u ?? 0) - 0.5) * (size[0] ?? 1) * lift,
          (0.5 - (v ?? 0)) * (size[1] ?? 1) * lift,
        );
        uvs.push((x + (u ?? 0) * width) / 1024, (y + (v ?? 0) * height) / 1024);
        metadata.push(marker.pulse ? 1 : 0, alpha);
      }
      const base = index * 4;
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    for (const [key, values] of Object.entries({
      aPosition: centers,
      aOffset: offsets,
      aUV: uvs,
      aMeta: metadata,
    })) {
      const buffer = page.geometry.getBuffer(key);
      buffer.data = new Float32Array(values);
      buffer.update();
    }
    const index = page.geometry.getIndex();
    index.data = new Uint16Array(indices);
    index.update();
  };
  const set = (next: GlobeMarker[]) => {
    generation++;
    const currentGeneration = generation;
    clear();
    assets = createSceneAssets();
    markers = next;
    for (let offset = 0; offset < markers.length; offset += 64) {
      const group = markers.slice(offset, offset + 64);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1024;
      const context = canvas.getContext("2d");
      if (!context) continue;
      const texture = Texture.from(canvas);
      texture.source.scaleMode = "linear";
      const geometry = new Geometry({
        attributes: {
          aPosition: { buffer: new Float32Array(3), format: "float32x3", stride: 12 },
          aOffset: { buffer: new Float32Array(2), format: "float32x2", stride: 8 },
          aUV: { buffer: new Float32Array(2), format: "float32x2", stride: 8 },
          aMeta: { buffer: new Float32Array(2), format: "float32x2", stride: 8 },
        },
        indexBuffer: new Uint16Array(6),
      });
      const shader = Shader.from({
        gl: {
          vertex: `precision highp float;
attribute vec3 aPosition; attribute vec2 aOffset; attribute vec2 aUV; attribute vec2 aMeta;
varying vec2 vUV; varying vec3 vCamera; varying float vAlpha;
uniform float uPhase;
${globeCameraShader}
void main() {
  float pulse = 1.0 + aMeta.x * uPhase * 0.15;
  vec3 world = aPosition + (uRight * aOffset.x + uUp * aOffset.y) * pulse;
  vCamera = cameraPoint(world); vUV = aUV; vAlpha = aMeta.y;
  gl_Position = globeProject(world);
}`,
          fragment: `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUV; varying vec3 vCamera; varying float vAlpha;
uniform sampler2D uAtlas;
${globeOcclusionShader}
void main() {
  if (behindGlobe(vCamera)) discard;
  gl_FragColor = texture2D(uAtlas, vUV) * vAlpha;
}`,
        },
        resources: { camera: uniforms, uAtlas: texture.source },
      });
      const state = new State();
      state.blend = true;
      state.depthTest = false;
      state.depthMask = false;
      const page = { texture, geometry, shader };
      pages.push(page);
      rebuildGeometry(page, group);
      container.addChild(new Mesh({ geometry, shader, state }));
      group.forEach((marker, index) => {
        const x = (index % 8) * 128 + 2,
          y = Math.floor(index / 8) * 128 + 2;
        if (marker.kind === "label") {
          drawLabel(context, marker, x, y);
        } else if (marker.image) {
          const lease = assets;
          void Promise.all([
            lease.texture(marker.image),
            marker.kind === "avatar"
              ? lease.texture(IMG_SECTOR_USER_SPRITE_MASK)
              : Promise.resolve(null),
          ]).then(
            ([image, mask]) => {
              if (game.signal.aborted || currentGeneration !== generation) return;
              if (marker.kind === "avatar")
                drawAvatar(context, image, mask, marker.border ?? "white", x, y);
              else
                context.drawImage(
                  image.source.resource as CanvasImageSource,
                  x,
                  y,
                  64,
                  64,
                );
              texture.source.update();
            },
            (error) => {
              // A marker's unavailable art must not remove the navigable world surface.
              if (!game.signal.aborted && currentGeneration === generation)
                console.warn("Map marker art unavailable", error);
            },
          );
        }
      });
      texture.source.update();
    }
  };
  game.own(() => {
    generation++;
    clear();
  });
  return {
    container,
    set,
    emphasizeOwner: (owner: string | null) => {
      if (owner === hoveredOwner) return;
      hoveredOwner = owner;
      pages.forEach((page, index) => {
        rebuildGeometry(page, markers.slice(index * 64, index * 64 + 64));
      });
    },
    pick: (x: number, y: number) => {
      const ray = globeRay(x, y, camera);
      const hit = globeRayHit(ray, radius);
      const candidates = markers
        .filter((marker) => marker.clickable)
        .map((marker) => ({ marker, projected: globeProject(marker.point, camera) }))
        .sort((a, b) => a.projected.depth - b.projected.depth);
      for (const { marker, projected } of candidates) {
        const width = (marker.kind === "label" ? 2.5 : 1) * projected.scale;
        const height = projected.scale;
        if (
          Math.abs(x - projected.x) > width / 2 ||
          Math.abs(y - projected.y) > height / 2
        )
          continue;
        const focal = camera.height / (2 * Math.tan(GLOBE_HALF_FOV));
        const planeDistance =
          projected.depth *
          Math.hypot(
            (x - camera.width / 2) / focal,
            (camera.height / 2 - y) / focal,
            1,
          );
        if (!hit || hit.distance >= planeDistance - 0.01) return marker.sector;
      }
      return null;
    },
  };
};

const drawLabel = (
  context: CanvasRenderingContext2D,
  marker: GlobeMarker,
  x: number,
  y: number,
) => {
  context.save();
  context.translate(x, y);
  const fill = marker.fill ?? "#ffffff",
    text = contrastingTextColor(fill);
  context.globalAlpha = 0.9;
  context.fillStyle = fill;
  context.strokeStyle = "black";
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(2, 2, 96, 36, 4);
  context.stroke();
  context.fill();
  context.globalAlpha = 1;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = text;
  context.strokeStyle = text === "#000000" ? "#F0F0F0" : "#1a1a1a";
  context.font = `${42 - (marker.nameLength ?? marker.text?.length ?? 0) * 2}px arial narrow`;
  context.strokeText(marker.text ?? "", 50, 20, 88);
  context.fillText(marker.text ?? "", 50, 20, 88);
  context.restore();
};

const drawAvatar = (
  context: CanvasRenderingContext2D,
  image: Texture,
  mask: Texture | null,
  border: string,
  x: number,
  y: number,
) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const avatar = canvas.getContext("2d", { willReadFrequently: true });
  if (!avatar) return;
  avatar.drawImage(image.source.resource as CanvasImageSource, 0, 0, 64, 64);
  if (mask) {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = maskCanvas.height = 64;
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (maskContext) {
      maskContext.drawImage(mask.source.resource as CanvasImageSource, 0, 0, 64, 64);
      const pixels = avatar.getImageData(0, 0, 64, 64),
        alpha = maskContext.getImageData(0, 0, 64, 64);
      // The retained mask stores coverage in green; its own alpha can be fully opaque.
      for (let i = 3; i < pixels.data.length; i += 4)
        pixels.data[i] = ((pixels.data[i] ?? 0) * (alpha.data[i - 2] ?? 0)) / 255;
      avatar.putImageData(pixels, 0, 0);
    }
  }
  context.save();
  context.fillStyle = border;
  context.beginPath();
  context.arc(x + 32, y + 32, 30, 0, Math.PI * 2);
  context.fill();
  context.drawImage(canvas, x + 64 / 12, y + 64 / 12, 64 / 1.2, 64 / 1.2);
  context.restore();
};

export type GlobeMarker = {
  kind: "label" | "avatar" | "pin";
  sector: number;
  point: GlobalPoint;
  text?: string;
  nameLength?: number;
  fill?: string;
  owner?: string;
  image?: string;
  border?: string;
  pulse?: boolean;
  clickable?: boolean;
};
