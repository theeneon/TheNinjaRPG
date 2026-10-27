import { Container, Sprite } from "pixi.js";
import { createSceneAssets } from "@/libs/rendering/assets";
import { acquireMaskedTexture } from "@/libs/rendering/maskedTextures";
import type { GameFrame, GameRenderer } from "@/libs/rendering/runtime";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";

/** Map coordinates grow upward; the camera flips Y and these sprites keep artwork upright. */
export const createWorldSprites = async (
  game: GameRenderer,
  descriptions: WorldSpriteDescription[],
) => {
  const assets = createSceneAssets();
  const masked: ReturnType<typeof acquireMaskedTexture>[] = [];
  const container = new Container();
  const entries: { sprite: Sprite; description: WorldSpriteDescription }[] = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!container.destroyed)
      container.destroy({ children: true, texture: false, textureSource: false });
    assets.dispose();
    for (const lease of masked) lease.release();
    masked.length = 0;
  };
  game.own(dispose);
  const settled = await Promise.allSettled(
    descriptions.map(async (description) => {
      const lease = description.mask
        ? acquireMaskedTexture(
            description.image,
            description.mask,
            description.rendition,
          )
        : null;
      if (lease) masked.push(lease);
      const texture = await (lease?.resource ??
        assets.texture(
          description.image,
          description.rendition,
          description.nearest ? "nearest" : "linear",
        ));
      if (disposed || game.signal.aborted) return null;
      return { texture, description };
    }),
  );
  if (disposed || game.signal.aborted) {
    dispose();
    throw new DOMException("Scenery cancelled", "AbortError");
  }
  let missing = 0;
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      const { texture, description } = result.value;
      const sprite = new Sprite(texture);
      sprite.label = description.id;
      sprite.anchor.set(description.anchorX ?? 0.5, description.anchorY ?? 0.5);
      sprite.position.set(description.x, description.y);
      sprite.width =
        description.width ??
        (description.preserveAspect
          ? (description.size * texture.width) / texture.height
          : description.size);
      sprite.height = description.size;
      sprite.scale.y *= -1;
      sprite.tint = description.tint ?? 0xffffff;
      sprite.rotation = description.rotation ?? 0;
      entries.push({ sprite, description });
      container.addChild(sprite);
    } else if (result.status === "rejected") {
      missing++;
      console.warn("Map scenery unavailable", result.reason);
    }
  }
  const wind = entries
    .filter(
      (entry) =>
        entry.description.wind !== null && entry.description.wind !== undefined,
    )
    .map((entry) => ({ ...entry, scaleY: entry.sprite.scale.y }));
  return {
    container,
    entries,
    missing,
    dispose,
    animate: (frame: GameFrame, zoom: number) => {
      const time = frame.reducedMotion ? 0 : frame.now / 1000;
      const phases = [0, 1, 2, 3].map((index) => {
        const phase = time * 2 + (index * Math.PI) / 2;
        return frame.reducedMotion ? 0 : Math.sin(phase) * Math.cos(phase * 0.7);
      });
      for (const entry of wind) {
        const { sprite, description } = entry;
        const phase =
          phases[Math.round((description.wind ?? 0) / (Math.PI / 2)) % 4] ?? 0;
        const dx = (phase * 0.0025 * game.renderer.width) / zoom;
        const dy = (phase * 0.00075 * game.renderer.height) / zoom;
        const shift = 1 - (description.anchorY ?? 0.5);
        sprite.skew.x = -Math.atan(dx / description.size);
        sprite.scale.y = entry.scaleY * (1 + dy / description.size);
        sprite.position.set(description.x + dx * shift, description.y + dy * shift);
      }
    },
  };
};
