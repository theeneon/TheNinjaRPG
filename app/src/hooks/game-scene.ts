import { type RefObject, useEffect, useRef, useState } from "react";

/** Cancels asynchronous scene initialization before releasing its canvas and resources. */
export const useGameScene = <T extends { dispose: () => void }>(
  mount: RefObject<HTMLElement | null>,
  create: (
    mount: HTMLElement,
    signal: AbortSignal,
    onError: (error: unknown) => void,
  ) => Promise<T>,
  resetKey: unknown = null,
) => {
  const factory = useRef(create);
  factory.current = create;
  const scene = useRef<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!mount.current) return;
    const controller = new AbortController();
    const onError = (cause: unknown) => {
      if (controller.signal.aborted) return;
      console.error("Game renderer failed", cause);
      setError(true);
    };
    void factory.current(mount.current, controller.signal, onError).then((instance) => {
      if (controller.signal.aborted) instance.dispose();
      else scene.current = instance;
    }, onError);
    return () => {
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [mount, resetKey]);
  return { scene, error };
};
