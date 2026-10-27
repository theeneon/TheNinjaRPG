/** One animation-frame request for all visible game canvases. */
export const createFrameLoop = (
  request: (callback: FrameRequestCallback) => number,
  cancel: (id: number) => void,
) => {
  const callbacks = new Set<FrameRequestCallback>();
  let pending: number | null = null;
  const tick: FrameRequestCallback = (now) => {
    pending = null;
    for (const callback of [...callbacks]) {
      if (callbacks.has(callback)) callback(now);
    }
    if (callbacks.size && pending === null) pending = request(tick);
  };
  return {
    subscribe: (callback: FrameRequestCallback) => {
      callbacks.add(callback);
      if (pending === null) pending = request(tick);
      return () => {
        callbacks.delete(callback);
        if (!callbacks.size && pending !== null) {
          cancel(pending);
          pending = null;
        }
      };
    },
  };
};
