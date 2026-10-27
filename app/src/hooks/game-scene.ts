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
  enabled = true,
) => {
  const factory = useRef(create);
  factory.current = create;
  const scene = useRef<T | null>(null);
  const [error, setError] = useState(false);
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    setError(false);
    setIsReady(false);
    if (!mount.current || !enabled) return;
    const controller = new AbortController();
    const onError = (cause: unknown) => {
      if (controller.signal.aborted) return;
      console.error("Game renderer failed", cause);
      setError(true);
      setIsReady(false);
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
    void factory.current(mount.current, controller.signal, onError).then((instance) => {
      if (controller.signal.aborted) instance.dispose();
      else {
        scene.current = instance;
        setIsReady(true);
      }
    }, onError);
    return () => {
      controller.abort();
      scene.current?.dispose();
      scene.current = null;
    };
  }, [mount, resetKey, enabled]);
  return { scene, error, isReady };
};
