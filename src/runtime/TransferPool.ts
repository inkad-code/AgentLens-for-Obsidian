/** Admission is shared by every transfer in this host, through publication/cleanup. */
export const DOWNLOAD_CONCURRENCY = 8;
export const LARGE_DOWNLOAD_CONCURRENCY = 4;
export const SMALL_FILE_LIMIT = 64 * 1024 * 1024;
export const BUFFERED_DOWNLOAD_CONCURRENCY = 2;
export const isSmallFile = (bytes?: number): boolean => Number.isSafeInteger(bytes) && bytes! > 0 && bytes! < SMALL_FILE_LIMIT;
export interface TransferLease { updateSize(bytes?: number, signal?: AbortSignal): Promise<void> }
export interface TransferOptions {
  sizeBytes?: number | undefined;
  buffered?: boolean | undefined;
  waitForSlot?: ((milliseconds: number, signal?: AbortSignal) => Promise<void>) | undefined;
}
type Release = () => Promise<void>;
type Ticket = { category: string };
type Shared = { busy: Set<string>; queues: Map<string, Ticket[]> };
const sharedKey = Symbol.for("agentlens.transfer-pool.v2");
const globals = window as typeof window & { [sharedKey]?: Shared };
const shared: Shared = globals[sharedKey] ??= { busy: new Set<string>(), queues: new Map<string, Ticket[]>() };

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { window.clearTimeout(timer); signal?.removeEventListener("abort", abort); resolve(); };
    const abort = () => { window.clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Transfer canceled", "AbortError")); };
    const timer = window.setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** A claimed Web Lock stays held until the returned release has settled. */
async function claim(prefix: string, count: number): Promise<Release | undefined> {
  for (let slot = 0; slot < count; slot++) {
    const name = `${prefix}:${slot}`;
    if (shared.busy.has(name)) continue;
    shared.busy.add(name);
    const locks = window.navigator?.locks;
    if (!locks) return async () => { shared.busy.delete(name); };
    let unlock!: () => void;
    const held = new Promise<void>(resolve => { unlock = resolve; });
    let ready!: (acquired: boolean) => void;
    const granted = new Promise<boolean>(resolve => { ready = resolve; });
    const done = locks.request(name, { ifAvailable: true }, async lock => {
      ready(Boolean(lock));
      if (lock) await held;
    });
    void done.catch(() => ready(false));
    if (await granted) return async () => { unlock(); try { await done; } finally { shared.busy.delete(name); } };
    shared.busy.delete(name);
    await done;
  }
  return undefined;
}

export async function transfer<T>(scope: string, work: (lease: TransferLease) => Promise<T>, signal?: AbortSignal,
  options: TransferOptions = {}): Promise<T> {
  const prefix = `agentlens:transfer:${scope}`;
  const queue = shared.queues.get(prefix) ?? [];
  shared.queues.set(prefix, queue);
  const ticket = { category: `${isSmallFile(options.sizeBytes) ? "small" : "large"}:${Boolean(options.buffered)}` };
  queue.push(ticket);
  const waitForSlot = options.waitForSlot ?? wait;
  let total: Release | undefined, large: Release | undefined, buffered: Release | undefined;
  const removeTicket = () => { const index = queue.indexOf(ticket); if (index >= 0) queue.splice(index, 1); };
  try {
    for (;;) {
      signal?.throwIfAborted();
      // FIFO within each class; a saturated large queue must not block small files.
      if (queue.find(item => item.category === ticket.category) !== ticket) { await waitForSlot(20, signal); continue; }
      total = await claim(prefix, DOWNLOAD_CONCURRENCY);
      if (total) {
        if (!isSmallFile(options.sizeBytes)) large = await claim(`${prefix}:large`, LARGE_DOWNLOAD_CONCURRENCY);
        if (options.buffered) buffered = await claim(`${prefix}:buffered`, BUFFERED_DOWNLOAD_CONCURRENCY);
        if ((isSmallFile(options.sizeBytes) || large) && (!options.buffered || buffered)) break;
        await buffered?.(); buffered = undefined;
        await large?.(); large = undefined;
        await total(); total = undefined;
      }
      await waitForSlot(20, signal);
    }
    removeTicket();
    signal?.throwIfAborted();
    const lease: TransferLease = {
      async updateSize(bytes, updateSignal = signal) {
        updateSignal?.throwIfAborted();
        if (isSmallFile(bytes)) { await large?.(); large = undefined; return; }
        // The caller pauses body reads while a misdeclared small file is promoted.
        while (!large) { large = await claim(`${prefix}:large`, LARGE_DOWNLOAD_CONCURRENCY); if (!large) await waitForSlot(20, updateSignal); }
        updateSignal?.throwIfAborted();
      }
    };
    return await work(lease);
  } finally {
    removeTicket();
    await buffered?.(); await large?.(); await total?.();
    if (!queue.length && shared.queues.get(prefix) === queue) shared.queues.delete(prefix);
  }
}

export async function parallelEach<T>(items: readonly T[], work: (item: T, index: number) => Promise<void>, limit = DOWNLOAD_CONCURRENCY): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) { const index = next++; if (index >= items.length) return; await work(items[index]!, index); }
  });
  const results = await Promise.allSettled(workers);
  const failed = results.find((item): item is PromiseRejectedResult => item.status === "rejected");
  if (failed) throw failed.reason;
}

/** Bounded admission preparation per class avoids large waiters occupying every batch worker. */
export async function parallelBySize<T>(items: readonly T[], work: (item: T, index: number) => Promise<void>, sizeOf: (item: T) => number | undefined): Promise<void> {
  const groups: Array<Array<{ item: T; index: number }>> = [[], [], []];
  items.forEach((item, index) => { const size = sizeOf(item); groups[isSmallFile(size) ? 0 : Number.isSafeInteger(size) && size! > 0 ? 1 : 2]!.push({ item, index }); });
  const results = await Promise.allSettled(groups.map((group, i) => parallelEach(group, entry => work(entry.item, entry.index), i === 1 ? LARGE_DOWNLOAD_CONCURRENCY : DOWNLOAD_CONCURRENCY)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
}

/** Keep explicit test/operator deadlines; default large-file deadlines scale with size. */
export function downloadDeadline(bytes?: number, configuredMs = 10 * 60_000): number {
  if (configuredMs !== 10 * 60_000) return configuredMs;
  const estimate = Number.isSafeInteger(bytes) && bytes! > 0 ? bytes! / (256 * 1024) * 1000 + 120_000 : configuredMs;
  return Math.min(2 * 60 * 60_000, Math.max(configuredMs, estimate));
}
/** Preflight includes temporary bytes, a publication copy and a 512 MiB reserve. */
export function assertDownloadSpace(stats: { bavail: number; bsize: number }, bytes?: number): void {
  const expected = Number.isSafeInteger(bytes) && bytes! > 0 ? bytes! : SMALL_FILE_LIMIT;
  if (stats.bavail * stats.bsize < expected * 2 + 512 * 1024 * 1024) throw new Error("Not enough disk space to download and publish this media file.");
}
