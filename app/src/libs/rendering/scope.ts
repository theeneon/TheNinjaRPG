import { createSceneAssets } from "@/libs/rendering/assets";
import type { GameRenderer } from "@/libs/rendering/runtime";

/** A removable actor or sector releases its leases without waiting for the scene to unmount. */
export const createRenderScope = (parent: GameRenderer): GameRenderer => {
  const controller = new AbortController();
  const assets = createSceneAssets();
  const cleanups = new Set<() => void>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    controller.abort();
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    assets.dispose();
    parent.disown(dispose);
  };
  parent.own(dispose);
  return {
    ...parent,
    signal: controller.signal,
    assets,
    dispose,
    isDisposed: () => disposed || parent.isDisposed(),
    disown: (cleanup) => {
      cleanups.delete(cleanup);
    },
    own: (cleanup) => {
      if (disposed) cleanup();
      else cleanups.add(cleanup);
    },
  };
};
