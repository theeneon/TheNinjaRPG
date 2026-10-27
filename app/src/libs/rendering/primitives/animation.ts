import { Rectangle, Sprite, Texture } from "pixi.js";
import { type AnimationClip, sampleAnimationClip } from "@/libs/rendering/animation";
import type { GameRenderer } from "@/libs/rendering/runtime";

/** Each animation owns texture views; decoded image sources remain leased and immutable. */
export const createSpriteClip = async (
  game: GameRenderer,
  clip: AnimationClip,
  options: { size: number; rendition?: number; nearest?: boolean },
) => {
  const sources = await Promise.all(
    clip.images.map((url) =>
      game.assets.texture(
        url,
        options.rendition ?? 50,
        options.nearest ? "nearest" : "linear",
      ),
    ),
  );
  if (game.isDisposed() || game.signal.aborted)
    throw new DOMException("Animation cancelled", "AbortError");
  const views = Array.from({ length: clip.frameCount }, (_, index) => {
    const source = sources.length === 1 ? sources[0] : sources[index];
    if (!source) throw new Error(`Animation source ${index} is missing`);
    const frame = sources.length === 1 ? index : 0;
    const width = source.width / clip.columns,
      height = source.height / clip.rows;
    return new Texture({
      source: source.source,
      frame: new Rectangle(
        (frame % clip.columns) * width,
        Math.floor(frame / clip.columns) * height,
        width,
        height,
      ),
    });
  });
  const sprite = new Sprite(views[0]);
  sprite.anchor.set(0.5);
  sprite.width = options.size;
  sprite.height = options.size;
  sprite.scale.y *= -1;
  let disposed = false,
    index = -1;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (!sprite.destroyed) sprite.destroy({ texture: false, textureSource: false });
    for (const view of views) view.destroy(false);
  };
  game.own(dispose);
  return {
    sprite,
    dispose,
    renderAt: (elapsedMs: number, reducedMotion = false) => {
      const sample = sampleAnimationClip(clip, elapsedMs, reducedMotion);
      if (disposed) return sample;
      if (index !== sample.index) {
        index = sample.index;
        sprite.texture = views[index] ?? Texture.EMPTY;
      }
      sprite.visible = !sample.finished;
      return sample;
    },
  };
};
