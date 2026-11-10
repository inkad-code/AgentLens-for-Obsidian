export interface AutoFetchActivityScope {
  userId: string; installationId: string; creatorId: string; epoch: number; folderPath: string;
}

export interface AutoFetchActivity {
  parsing?: boolean;
  importing?: boolean;
}

/** Live process facts only; persisted job IDs never prove that work is active. */
export class AutoFetchActivityTracker {
  private readonly counts = new Map<string, { parsing: number; importing: number }>();
  private readonly listeners = new Set<() => void>();
  private readonly sourceSettledListeners = new Set<() => void>();
  subscribeSourceSettled(listener: () => void): () => void {
    this.sourceSettledListeners.add(listener);
    return () => { this.sourceSettledListeners.delete(listener); };
  }
  get(scope: string | AutoFetchActivityScope): AutoFetchActivity {
    const count = this.counts.get(this.key(scope));
    return { parsing: Boolean(count?.parsing), importing: Boolean(count?.importing) };
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async track<T>(scope: string | AutoFetchActivityScope, kind: "parsing" | "importing", work: () => Promise<T>): Promise<T> {
    const count = this.counts.get(this.key(scope)) ?? { parsing: 0, importing: 0 };
    count[kind] += 1;
    this.counts.set(this.key(scope), count);
    this.emit();
    try { return await work(); }
    finally {
      count[kind] -= 1;
      if (!count.parsing && !count.importing) this.counts.delete(this.key(scope));
      this.emit();
      if (kind === "parsing") for (const listener of this.sourceSettledListeners) {
        try { listener(); } catch { /* Balance observers cannot change source results. */ }
      }
    }
  }
  private key(scope: string | AutoFetchActivityScope): string {
    return typeof scope === "string" ? JSON.stringify(["legacy", scope])
      : JSON.stringify([scope.userId, scope.installationId, scope.creatorId, scope.epoch, scope.folderPath]);
  }
  private emit(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Observers cannot interrupt execution or leak an active count. */ }
    }
  }
}
