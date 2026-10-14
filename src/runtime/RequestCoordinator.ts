export class RequestCoordinator {
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

