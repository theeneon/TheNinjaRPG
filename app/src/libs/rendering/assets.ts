import { Assets, type Texture } from "pixi.js";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import { textureImageUrl } from "@/utils/image";

const IDLE_TEXTURE_BUDGET = 16 * 1024 * 1024;
const textures = createLeaseCache<Texture>({
  load: (url) =>
    Assets.load<Texture>({
      src: url,
      // SVG textures need rasterization; createImageBitmap only decodes raster images.
      parser:
        /\.svg(?:[?#]|$)/i.test(url) || url.startsWith("data:image/svg+xml")
          ? "loadSVG"
          : "loadTextures",
      data: { scaleMode: url.endsWith("#tnr-nearest") ? "nearest" : "linear" },
    }),
  unload: (url) => Assets.unload(url),
  bytes: (texture) => texture.source.pixelWidth * texture.source.pixelHeight * 4,
  idleBudget: IDLE_TEXTURE_BUDGET,
});

/** Scene leases share decoded images without allowing one scene to destroy another's. */
export const createSceneAssets = () => {
  const owned = new Map<string, ReturnType<typeof textures.acquire>>();
  let disposed = false;
  return {
    texture: (path: string, width = 50, sampling: "linear" | "nearest" = "linear") => {
      if (disposed) return Promise.reject(new Error("Scene assets are disposed"));
      const source = textureImageUrl(path, width);
      // Sampling is immutable for a shared source; nearest art owns a separate decoded source.
      const url =
        sampling === "nearest" ? `${source.split("#")[0]}#tnr-nearest` : source;
      const existing = owned.get(url);
      if (existing) return existing.resource;
      const entry = textures.acquire(url);
      owned.set(url, entry);
      return entry.resource;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const entry of owned.values()) entry.release();
      owned.clear();
    },
  };
};

export type SceneAssets = ReturnType<typeof createSceneAssets>;
