export interface ScheduledHandle {
  readonly cancel: () => void;
}

export interface Scheduler {
  readonly schedule: (callback: () => void, delayMs: number) => ScheduledHandle;
}

export function createDefaultScheduler(): Scheduler {
  return {
    schedule: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs);
      const releasable = timer as unknown as { readonly unref?: () => void };
      releasable.unref?.();
      return {
        cancel: () => {
          clearTimeout(timer);
        },
      };
    },
  };
}
