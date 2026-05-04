export interface Semaphore {
  readonly acquire: () => Promise<void>;
  readonly release: () => void;
}

export function createSemaphore(cap: number): Semaphore {
  if (cap <= 0) throw new Error("semaphore cap must be positive");
  let inFlight = 0;
  const queue: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (inFlight < cap) {
      inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      queue.push(() => {
        inFlight += 1;
        resolve();
      });
    });
  };
  const release = (): void => {
    inFlight -= 1;
    const next = queue.shift();
    if (next !== undefined) next();
  };
  return { acquire, release };
}
