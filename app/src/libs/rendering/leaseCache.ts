/**
 * Reference-counted async resources. Release each acquisition when its owner ends,
 * even while loading; release is idempotent. Idle byte/count budgets exclude active
 * leases, and reacquisition waits for an in-flight unload of the same key.
 */
export const createLeaseCache = <T>(options: {
  load: (key: string) => Promise<T>;
  unload: (key: string) => Promise<void>;
  bytes: (resource: T) => number;
  idleBudget: number;
  idleLimit?: number;
}) => {
  const entries = new Map<string, Entry<T>>();
  const unloading = new Map<string, Promise<void>>();
  let sequence = 0;
  const trim = () => {
    const idle = [...entries.entries()]
      .filter(([, entry]) => entry.refs === 0 && entry.loaded)
      .sort(([, a], [, b]) => a.idleAt - b.idleAt);
    let bytes = idle.reduce((sum, [, entry]) => sum + entry.bytes, 0);
    let count = idle.length;
    for (const [key, entry] of idle) {
      if (bytes <= options.idleBudget && count <= (options.idleLimit ?? 64)) break;
      bytes -= entry.bytes;
      count--;
      entries.delete(key);
      const pending = options.unload(key);
      unloading.set(key, pending);
      void pending.then(
        () => {
          if (unloading.get(key) === pending) unloading.delete(key);
        },
        () => {
          if (unloading.get(key) === pending) unloading.delete(key);
        },
      );
    }
  };
  return {
    acquire: (key: string) => {
      let entry = entries.get(key);
      if (!entry) {
        const loading = Promise.resolve(unloading.get(key)).then(() =>
          options.load(key),
        );
        entry = { refs: 0, bytes: 0, idleAt: 0, loaded: false, loading };
        entries.set(key, entry);
        const current = entry;
        void loading.then(
          (resource) => {
            current.bytes = options.bytes(resource);
            current.loaded = true;
            trim();
          },
          () => {
            if (entries.get(key) === current) entries.delete(key);
          },
        );
      }
      entry.refs++;
      const current = entry;
      let released = false;
      return {
        resource: entry.loading,
        release: () => {
          if (released) return;
          released = true;
          current.refs--;
          current.idleAt = ++sequence;
          trim();
        },
      };
    },
  };
};

type Entry<T> = {
  refs: number;
  bytes: number;
  idleAt: number;
  loaded: boolean;
  loading: Promise<T>;
};
