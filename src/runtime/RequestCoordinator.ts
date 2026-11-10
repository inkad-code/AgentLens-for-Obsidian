export class RequestCoordinator {
  private readonly queues = new Map<string, Promise<unknown>>();

  enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(key, next);
    void next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => undefined);
    return next;
  }

  private readonly inFlight = new Map<string, Promise<unknown>>();

  runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const current = this.inFlight.get(key);
    if (current) return current as Promise<T>;

    const promise = operation().finally(() => {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  has(key: string): boolean {
    return this.inFlight.has(key);
  }
}

