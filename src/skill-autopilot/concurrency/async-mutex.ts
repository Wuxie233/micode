type QueueEntry = () => void;

export interface AsyncMutex {
  readonly run: <T>(key: string, work: () => Promise<T>) => Promise<T>;
}

export function createAsyncMutex(): AsyncMutex {
  const heads = new Map<string, Promise<unknown>>();
  return {
    run: async <T>(key: string, work: () => Promise<T>): Promise<T> => {
      const previous = heads.get(key) ?? Promise.resolve();
      let release: QueueEntry = () => {};
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      const queued = previous.then(() => next);
      heads.set(key, queued);
      await previous;
      try {
        return await work();
      } finally {
        release();
        if (heads.get(key) === queued) heads.delete(key);
      }
    },
  };
}
