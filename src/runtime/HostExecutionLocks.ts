/** Host-owned locks survive slow requests and are released when their renderer closes. */
export class HostExecutionLocks {
  private manager(): LockManager {
    const manager = window.navigator?.locks;
    if (!manager) throw new Error("This Obsidian window cannot coordinate background tasks. Update Obsidian and reopen the Vault.");
    return manager;
  }
  run<T>(scope: readonly string[], work: () => Promise<T>): Promise<T> {
    return this.manager().request(`agentlens:obsidian:${JSON.stringify(scope)}`, { mode: "exclusive" }, work);
  }
  tryRun<T>(scope: readonly string[], work: () => Promise<T>, unavailable: () => T): Promise<T> {
    return this.manager().request(`agentlens:obsidian:${JSON.stringify(scope)}`, { mode: "exclusive", ifAvailable: true },
      lock => lock ? work() : unavailable());
  }
}
export const hostExecutionLocks = new HostExecutionLocks();
