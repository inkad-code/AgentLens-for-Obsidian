/** Deterministic host API stand-in shared by independently constructed renderer services. */
export class TestLockManager {
  private readonly queues = new Map<string, Array<() => void>>();
  request<T>(name: string, options: LockOptions, callback: (lock: Lock | null) => T | PromiseLike<T>): Promise<T> {
    if (options.ifAvailable && this.queues.has(name)) return Promise.resolve().then(() => callback(null));
    return new Promise<T>((resolve, reject) => {
      const queue = this.queues.get(name) ?? [];
      const start = () => {
        const release = () => {
          queue.shift();
          if (queue.length) queue[0]!(); else this.queues.delete(name);
        };
        Promise.resolve().then(() => callback({ name, mode: "exclusive" } as Lock)).then(
          value => { release(); resolve(value); }, error => { release(); reject(error); });
      };
      queue.push(start); this.queues.set(name, queue);
      if (queue.length === 1) start();
    });
  }
}
