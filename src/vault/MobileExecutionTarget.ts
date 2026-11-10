import { hostExecutionLocks } from "../runtime/HostExecutionLocks";
import type { NativeExecutionTarget } from "../runtime/NativeExecutionTarget";

interface LocalIdentityStorage {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, value: unknown): void;
}
interface ProbeAdapter {
  stat(path: string): Promise<{ type: string } | null>;
  exists(path: string): Promise<boolean>;
  write(path: string, data: string): Promise<void>;
  read(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}
const KEY = "agentlens-mobile-execution-target-v1";
const PROBE_KEY = `${KEY}-probe`;
interface ProbeJournal { version: 1; targetId: string; directory: string; nonce: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vault-local host storage is separate from copied plugin data. Never derive identity from a name. */
export class MobileExecutionTarget {
  private inFlight: Promise<NativeExecutionTarget> | undefined;
  private observed?: { at: number; value: NativeExecutionTarget };
  constructor(private readonly storage: LocalIdentityStorage, private readonly adapter: ProbeAdapter,
    private readonly probeDirectory: string, private readonly randomId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = Date.now) {}

  async resolve(): Promise<NativeExecutionTarget> {
    let id = this.storage.loadLocalStorage(KEY);
    if (id === null || id === undefined) {
      id = this.randomId();
      if (typeof id !== "string" || !UUID.test(id)) throw new Error("A stable mobile Vault identity could not be created.");
      this.storage.saveLocalStorage(KEY, id);
    }
    if (typeof id !== "string" || !UUID.test(id) || this.storage.loadLocalStorage(KEY) !== id)
      throw new Error("Mobile Vault identity is unavailable; retain the original execution records.");
    const targetId = `obsidian-vault-local-${id}`;
    const age = this.observed && this.now() - this.observed.at;
    if (this.observed?.value.targetId === targetId && age !== undefined && age >= 0 && age < 30_000)
      return { ...this.observed.value };
    if (this.inFlight) return this.inFlight.then(value => {
      if (value.targetId !== targetId || this.storage.loadLocalStorage(KEY) !== id) throw new Error("Mobile Vault identity changed during verification.");
      return {...value};
    });
    const task = hostExecutionLocks.run(["mobile-target-probe", targetId], () => this.probe(targetId)).then(value => {
      if (this.storage.loadLocalStorage(KEY) !== id) throw new Error("Mobile Vault identity changed during verification.");
      this.observed = {at: this.now(), value}; return {...value};
    }).finally(() => { this.inFlight = undefined; });
    this.inFlight = task;
    return task;
  }

  private async probe(targetId: string): Promise<NativeExecutionTarget> {
    const value = {targetId, healthy: false, writable: false};
    const nonce = this.randomId();
    if (!UUID.test(nonce)) return value;
    const path = `${this.probeDirectory}/.agentlens-write-probe-${nonce}.tmp`;
    const content = `agentlens-probe:${nonce}`;
    let attempted = false;
    try {
      if ((await this.adapter.stat(this.probeDirectory))?.type !== "folder") return value;
      value.healthy = true;
      if (!await this.cleanupProbe(targetId)) return value;
      if (await this.adapter.exists(path)) return value;
      // Reserve durable cleanup evidence before any file write. Never overwrite an existing reservation.
      if (this.storage.loadLocalStorage(PROBE_KEY) != null) return value;
      const journal: ProbeJournal = {version: 1, targetId, directory: this.probeDirectory, nonce};
      this.storage.saveLocalStorage(PROBE_KEY, journal);
      if (!this.currentJournal(journal)) return value;
      attempted = true;
      await this.adapter.write(path, content);
      if (await this.adapter.read(path) !== content) return value;
      value.writable = await this.cleanupProbe(targetId);
      attempted = !value.writable;
      return value;
    } catch { return value; }
    finally {
      if (attempted) await this.cleanupProbe(targetId);
    }
  }

  private currentJournal(journal: ProbeJournal): boolean {
    return `obsidian-vault-local-${String(this.storage.loadLocalStorage(KEY))}` === journal.targetId
      && JSON.stringify(this.storage.loadLocalStorage(PROBE_KEY)) === JSON.stringify(journal);
  }

  private async cleanupProbe(targetId: string): Promise<boolean> {
    try {
      const saved = this.storage.loadLocalStorage(PROBE_KEY);
      if (saved == null) return true;
      if (!saved || typeof saved !== "object") return false;
      const journal = saved as ProbeJournal;
      if (journal.version !== 1 || journal.targetId !== targetId || journal.directory !== this.probeDirectory
          || typeof journal.nonce !== "string" || !UUID.test(journal.nonce) || !this.currentJournal(journal)) return false;
      // Reconstruct paths from the validated nonce and current directory, never from an arbitrary stored path.
      const path = `${this.probeDirectory}/.agentlens-write-probe-${journal.nonce}.tmp`;
      if (await this.adapter.exists(path)) {
        if (await this.adapter.read(path) !== `agentlens-probe:${journal.nonce}` || !this.currentJournal(journal)) return false;
        await this.adapter.remove(path);
        if (await this.adapter.exists(path)) return false;
      }
      if (!this.currentJournal(journal)) return false;
      this.storage.saveLocalStorage(PROBE_KEY, null);
      return this.storage.loadLocalStorage(PROBE_KEY) == null;
    } catch { return false; }
  }
}
