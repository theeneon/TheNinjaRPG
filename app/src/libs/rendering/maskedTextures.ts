import { Texture } from "pixi.js";
import { createSceneAssets } from "@/libs/rendering/assets";
import { createLeaseCache } from "@/libs/rendering/leaseCache";

const textures = createLeaseCache<Texture>({
  load: async (key) => {
    const { image, mask, width } = JSON.parse(key) as {
      image: string;
      mask: string;
      width: number;
    };
    const assets = createSceneAssets();
    try {
      const [source, coverage] = await Promise.all([
        assets.texture(image, width),
        assets.texture(mask),
      ]);
      const canvas = document.createElement("canvas"),
        maskCanvas = document.createElement("canvas");
      canvas.width = canvas.height = maskCanvas.width = maskCanvas.height = 128;
      const imageContext = canvas.getContext("2d", { willReadFrequently: true });
      const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
      if (!imageContext || !maskContext)
        throw new Error("Cannot compose game sprite mask");
      imageContext.drawImage(
        source.source.resource as CanvasImageSource,
        0,
        0,
        128,
        128,
      );
      maskContext.drawImage(
        coverage.source.resource as CanvasImageSource,
        0,
        0,
        128,
        128,
      );
      const pixels = imageContext.getImageData(0, 0, 128, 128),
        alpha = maskContext.getImageData(0, 0, 128, 128);
      for (let index = 3; index < pixels.data.length; index += 4)
        pixels.data[index] =
          ((pixels.data[index] ?? 0) * (alpha.data[index - 2] ?? 0)) / 255;
      imageContext.putImageData(pixels, 0, 0);
      const texture = Texture.from(canvas);
      loaded.set(key, texture);
      return texture;
    } finally {
      assets.dispose();
    }
  },
  unload: async (key) => {
    const texture = loaded.get(key);
    loaded.delete(key);
    texture?.destroy(true);
  },
  bytes: (texture) => texture.width * texture.height * 4,
  idleBudget: 4 * 1024 * 1024,
});
const loaded = new Map<string, Texture>();

/**
 * Leases a shared 128px composite using the mask's green coverage. width selects
 * the source rendition; release the lease instead of destroying the returned texture.
 */
export const acquireMaskedTexture = (image: string, mask: string, width = 50) => {
  const key = JSON.stringify({ image, mask, width });
  const lease = textures.acquire(key);
  return lease;
};
