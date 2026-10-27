import { Assets, type Texture } from "pixi.js";
import { createLeaseCache } from "@/libs/rendering/leaseCache";
import { textureImageUrl } from "@/utils/image";

const IDLE_TEXTURE_BUDGET = 16 * 1024 * 1024;
const textures = createLeaseCache<Texture>({
  load: (url) => Assets.load<Texture>({ src: url, parser: "loadTextures" }),
  unload: (url) => Assets.unload(url),
  bytes: (texture) => texture.source.pixelWidth * texture.source.pixelHeight * 4,
  idleBudget: IDLE_TEXTURE_BUDGET,
});

/** Scene leases share decoded images without allowing one scene to destroy another's. */
export const createSceneAssets = () => {
  const owned = new Map<string, ReturnType<typeof textures.acquire>>();
  let disposed = false;
  return {
    texture: (path: string, width = 50) => {
      if (disposed) return Promise.reject(new Error("Scene assets are disposed"));
      const url = textureImageUrl(path, width);
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
