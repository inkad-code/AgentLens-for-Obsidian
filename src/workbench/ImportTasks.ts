import type { CreatorRecord, CreatorUpdatePage } from "../api/AgentLensApiClient";
import { sanitizePreviewForPersistence } from "./DurableActionStore";
import type { PluginStateStore } from "../runtime/PluginStateStore";
import type { SchedulerCheckpoint } from "./DurableActionStore";
import type { PreviewResult } from "./types";
import type { NoteWriteManifest, VaultWriteResult } from "../vault/VaultWriter";

export interface DownloadProgress { receivedBytes: number; totalBytes?: number | undefined }
export type ImportPhase = "checking" | "downloading" | "saving" | "saved" | "skipped" | "linked" | "failed" | "cancelled" | "waiting";
export interface ImportFile extends DownloadProgress {
  id: string; name: string; phase: ImportPhase; error?: string | undefined;
}
export interface ImportNote {
  key: string; path: string; phase: ImportPhase; files: ImportFile[];
  /** Local retry intent, never a second provider fetch. */
  preview: PreviewResult; manifest: NoteWriteManifest;
}
export interface ImportTask {
  checkpoint: SchedulerCheckpoint;
  id: string; accountId: string; installationId: string; creatorId: string;
  platform?: string | undefined;
  avatarUrl?: string | undefined; handle?: string | undefined; credits?: number | undefined; pages?: Record<string, number | null>;
  creatorName: string; folderPath: string; requestId: string; time: string;
  phase: ImportPhase; error?: string | undefined; lastFailureAt?: string | undefined;
  updatedAt?: string | undefined;
  fetchError?: string | undefined;
  deliveryErrors?: Record<string, readonly string[]>;
  notes: ImportNote[];
}
export interface ImportTaskContext { id: string; signal: AbortSignal }
export type ImportTaskFilter = "all" | "importing" | "completed" | "failed";
export interface ImportTaskPage { tasks: readonly ImportTask[]; nextCursor?: string | undefined }
/** Empty successful checks remain execution evidence, but are not import history. */
export function taskVisibleInHistory(task: ImportTask): boolean {
  return task.notes.length > 0 || !["saved", "skipped"].includes(task.phase) || Boolean(task.error || task.fetchError);
}
export function matchesImportTask(task: ImportTask, filter: ImportTaskFilter): boolean {
  if (!taskVisibleInHistory(task)) return false;
  return filter === "all" || (filter === "importing" ? taskActive(task) : filter === "failed" ? taskFailed(task) : !taskActive(task));
}
const taskOrder = (a: Pick<ImportTask, "time" | "id">, b: Pick<ImportTask, "time" | "id">) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id);
export interface ImportTaskPort {
  importTasks(): Promise<readonly ImportTask[]>;
  importTaskHistory(cursor?: string, filter?: ImportTaskFilter): Promise<ImportTaskPage>;
  subscribeImportTasks(listener: () => void): () => void;
  cancelImportTask(id: string): Promise<void>;
  retryImportTask(id: string): Promise<void>;
}
export function taskActive(task: ImportTask): boolean {
  return ["checking", "downloading", "saving", "waiting"].includes(task.phase);
}
export function taskFailed(task: ImportTask): boolean {
  return task.phase === "failed" || task.notes.some(note => note.phase === "failed" || note.files.some(file => file.phase === "failed"));
}
export function importStatus(tasks: readonly ImportTask[], now = Date.now()): "importing" | "failed" | "completed" {
  if (tasks.some(taskActive)) return "importing";
  if (tasks.some(task => task.lastFailureAt && now - Date.parse(task.lastFailureAt) >= 0
    && now - Date.parse(task.lastFailureAt) < 86_400_000)) return "failed";
  return "completed";
}

/** Vault-local journal. Byte progress stays in memory; lifecycle changes are durable. */
export class ImportTasks {
  private tasks: ImportTask[] = [];
  private loaded = false;
  private installationId = "";
  private loading: Promise<void> | undefined;
  private creators = new Map<string, CreatorRecord>();
  async rememberCreators(creators: readonly CreatorRecord[], accountId: string): Promise<void> {
    await this.load();
    for (const creator of creators) this.creators.set(JSON.stringify([accountId, creator.creatorId]), creator);
    let changed = false;
    for (const task of this.tasks) if (task.accountId === accountId && task.installationId === this.installationId) {
      const creator = creators.find(item => item.creatorId === task.creatorId);
      if (creator) changed = this.snapshotCreator(task, creator) || changed;
    }
    if (changed) await this.persist();
    else this.emit();
  }
  private snapshotCreator(task: ImportTask, creator: CreatorRecord): boolean {
    const snapshot = { creatorName: creator.displayName, platform: creator.platform,
      avatarUrl: creator.avatarUrl ?? task.avatarUrl, handle: creator.handle ?? task.handle };
    const changed = Object.entries(snapshot).some(([key, value]) => task[key as keyof ImportTask] !== value);
    Object.assign(task, snapshot);
    return changed;
  }
  private readonly controllers = new Map<string, AbortController>();
  private readonly fetchingTasks = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private lastProgress = 0;
  constructor(private readonly store: PluginStateStore) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = this.loadOnce().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  private async loadOnce(): Promise<void> {
    const state = await this.store.load();
    this.installationId = state.installationId;
    if (state.importTasks !== undefined && (!Array.isArray(state.importTasks) || state.importTasks.some(task => !task || typeof task.id !== "string" || !task.checkpoint || !Array.isArray(task.notes) || task.notes.some(note => !Array.isArray(note.files))))) throw new Error("Stored task history needs repair. Execution records have been retained.");
    this.tasks = structuredClone(state.importTasks ?? []).map(task => ({ ...task,
      phase: taskActive(task) ? "waiting" : task.phase,
      notes: task.notes.map(note => ({ ...note, phase: ["checking", "downloading", "saving"].includes(note.phase) ? "waiting" : note.phase,
        files: note.files.map(file => ({ ...file, phase: ["checking", "downloading", "saving"].includes(file.phase) ? "waiting" : file.phase })) })) }));
    this.loaded = true;
  }
  async list(accountId: string): Promise<readonly ImportTask[]> {
    await this.load();
    return structuredClone(this.tasks.filter(task => task.accountId === accountId && task.installationId === this.installationId).sort(taskOrder));
  }
  async recent(accountId: string): Promise<readonly ImportTask[]> {
    const tasks = await this.list(accountId);
    const now = Date.now();
    const updated = new Set([...tasks].sort((a, b) => (b.updatedAt ?? b.time).localeCompare(a.updatedAt ?? a.time)).slice(0, 50).map(task => task.id));
    return tasks.filter((task, index) => index < 50 || updated.has(task.id) || taskActive(task) || (task.lastFailureAt && now - Date.parse(task.lastFailureAt) < 86_400_000));
  }
  async history(accountId: string, cursor?: string, filter: ImportTaskFilter = "all"): Promise<ImportTaskPage> {
    await this.load();
    let after: { time: string; id: string } | undefined;
    if (cursor) {
      try {
        const value = JSON.parse(cursor) as { accountId: string; installationId: string; filter: string; time: string; id: string };
        if (value.accountId !== accountId || value.installationId !== this.installationId || value.filter !== filter
          || typeof value.time !== "string" || typeof value.id !== "string") throw new Error();
        after = value;
      } catch { throw new Error("Task history changed. Refresh tasks."); }
    }
    const tasks = (await this.list(accountId)).filter(task => matchesImportTask(task, filter) && (!after || taskOrder(task, after) > 0));
    const page = tasks.slice(0, 50);
    const last = page.at(-1);
    return { tasks: page, nextCursor: tasks.length > 50 && last ? JSON.stringify({ accountId, installationId: this.installationId, filter, time: last.time, id: last.id }) : undefined };
  }
  async get(id: string, accountId: string): Promise<ImportTask> {
    const task = (await this.list(accountId)).find(item => item.id === id);
    if (!task) throw new Error("This task is unavailable for the current account and Vault.");
    return task;
  }
  private async persist(): Promise<void> {
    // History is paged for display, never discarded merely because newer checks finish.
    const snapshot = structuredClone(this.tasks).map(task => ({ ...task, notes: task.notes.map(note => ({ ...note, preview: sanitizePreviewForPersistence(note.preview) })) }));
    await this.store.update(state => { state.importTasks = snapshot; });
    this.emit();
  }
  async cancel(id: string, accountId: string): Promise<void> {
    await this.get(id, accountId);
    const task = this.tasks.find(item => item.id === id)!;
    if (!taskActive(task) && task.phase !== "waiting") return;
    this.controllers.get(id)?.abort();
    task.phase = "cancelled";
    task.error = "Cancelled. Notes and attachments already saved are retained.";
    await this.persist();
  }
  async run(checkpoint: SchedulerCheckpoint, work: (context: ImportTaskContext) => Promise<boolean | "failed">, explicit = false): Promise<void> {
    await this.load();
    let task = this.tasks.find(item => item.id === checkpoint.id);
    if (task?.phase === "cancelled" && !explicit) return;
    if (this.controllers.has(checkpoint.id)) throw new Error("This task is already running.");
    if (!task) {
      task = { checkpoint: structuredClone(checkpoint), id: checkpoint.id, accountId: checkpoint.accountId, installationId: checkpoint.installationId,
        creatorId: checkpoint.lease.creatorId, creatorName: checkpoint.lease.creatorId,
        folderPath: checkpoint.lease.saveFolderPath, requestId: checkpoint.requestId,
        time: new Date().toISOString(), phase: "checking", notes: [] };
      this.tasks.push(task);
    }
    const creator = this.creators.get(JSON.stringify([task.accountId, task.creatorId]));
    if (creator) this.snapshotCreator(task, creator);
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    task.phase = "checking"; task.error = undefined; task.fetchError = undefined;
    task.updatedAt = new Date().toISOString();
    try {
      await this.persist();
      const complete = await work({ id: task.id, signal: controller.signal });
      controller.signal.throwIfAborted();
      task.phase = complete === "failed" || task.notes.some(note => note.phase === "failed") ? "failed" : complete === true ? "saved" : "waiting";
      if (complete === "failed") task.error = "This source check ended unsuccessfully. Review its result before retrying.";
      if (complete === "failed") task.fetchError = task.error;
      if (task.phase === "failed") task.lastFailureAt = new Date().toISOString();
    } catch (error) {
      if (!controller.signal.aborted && this.fetchingTasks.has(task.id)) task.fetchError = error instanceof Error ? error.message : "Import failed.";
      task.phase = controller.signal.aborted ? "cancelled" : "failed";
      task.error = controller.signal.aborted ? "Cancelled. Already saved files are retained." : error instanceof Error ? error.message : "Import failed.";
      if (!controller.signal.aborted) task.lastFailureAt = new Date().toISOString();
      throw error;
    } finally {
      this.controllers.delete(task.id);
      this.fetchingTasks.delete(task.id);
      task.updatedAt = new Date().toISOString();
      await this.persist();
    }
  }
  async fetching(context: ImportTaskContext): Promise<void> {
    this.fetchingTasks.add(context.id);
    const task = this.tasks.find(item => item.id === context.id)!;
    task.phase = "checking";
    await this.persist();
  }
  /** Project completed indexed deliveries without creating a second execution queue. */
  async recordIndexedDelivery(checkpoint: SchedulerCheckpoint, page: CreatorUpdatePage,
    results: readonly { preview: PreviewResult; write: VaultWriteResult }[], errors: readonly string[], requestedAt?: string): Promise<void> {
    await this.load();
    let task = this.tasks.find(item => item.id === checkpoint.id);
    if (!task) {
      task = { checkpoint: structuredClone(checkpoint), id: checkpoint.id, accountId: checkpoint.accountId,
        installationId: checkpoint.installationId, creatorId: checkpoint.lease.creatorId,
        creatorName: checkpoint.lease.creatorId, folderPath: checkpoint.lease.saveFolderPath,
        requestId: page.requestId ?? checkpoint.requestId, time: requestedAt ?? new Date().toISOString(), phase: "saved", notes: [] };
      this.tasks.push(task);
    }
    if (task.accountId !== checkpoint.accountId || task.installationId !== checkpoint.installationId)
      throw new Error("Task delivery belongs to a different account or installation.");
    const creator = this.creators.get(JSON.stringify([task.accountId, task.creatorId]));
    if (creator) this.snapshotCreator(task, creator);
    for (const {preview, write} of results) {
      const manifest = write.manifest;
      const previous = task.notes.find(note => note.key === manifest.contentKey);
      const note: ImportNote = {key: manifest.contentKey, path: manifest.notePath, preview, manifest,
        phase: write.ledger.completion === "partial" ? "failed" : write.ledger.status === "skipped_duplicate" ? "skipped" : "saved",
        files: write.attachments.map(file => ({id: file.mediaId, name: file.path, receivedBytes: 0,
          phase: file.status === "skipped" && previous?.files.find(item => item.id === file.mediaId)?.phase === "saved" ? "saved" : file.status,
          error: file.error}))};
      if (previous?.phase === "saved" && note.phase === "skipped") note.phase = "saved";
      const index = task.notes.findIndex(item => item.key === note.key);
      if (index < 0) task.notes.push(note); else task.notes[index] = note;
      if (!creator) { task.creatorName = preview.post.author.displayName; task.platform = preview.post.platform; task.handle = preview.post.author.handle; }
    }
    task.deliveryErrors ??= {};
    task.deliveryErrors[page.fetchId] = errors;
    const remainingErrors = Object.values(task.deliveryErrors).flat();
    task.error = remainingErrors.length ? remainingErrors.join("; ") : undefined;
    task.phase = remainingErrors.length || task.notes.some(note => note.phase === "failed") ? "failed" : "saved";
    if (task.phase === "failed") task.lastFailureAt = new Date().toISOString();
    task.updatedAt = new Date().toISOString();
    await this.page({id: task.id, signal: new AbortController().signal}, page);
  }
  async page(context: ImportTaskContext, page: CreatorUpdatePage): Promise<void> {
    const task = this.tasks.find(item => item.id === context.id)!;
    if (!task.pages || !Object.keys(task.pages).length) task.requestId = page.requestId ?? task.requestId;
    task.checkpoint.lease = { ...task.checkpoint.lease, leaseId: page.fetchRunId };
    task.pages ??= {};
    const units = page.chargedUnits ?? page.usage?.units;
    task.pages[page.fetchId] = units === undefined ? task.pages[page.fetchId] ?? null : Math.max(task.pages[page.fetchId] ?? 0, units);
    const values = Object.values(task.pages);
    task.credits = values.every(value => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : undefined;
    await this.persist();
  }
  async beginNote(context: ImportTaskContext, preview: PreviewResult, manifest: NoteWriteManifest): Promise<void> {
    context.signal.throwIfAborted();
    this.fetchingTasks.delete(context.id);
    const task = this.tasks.find(item => item.id === context.id)!;
    task.creatorName = preview.post.author.displayName || task.creatorName;
    task.platform = preview.post.platform;
    task.handle = preview.post.author.handle ?? task.handle;
    task.phase = "saving";
    const previous = task.notes.find(item => item.key === manifest.contentKey);
    const note: ImportNote = { key: manifest.contentKey, path: manifest.notePath, phase: "saving", preview, manifest,
      files: manifest.attachments.map(file => ({ id: file.mediaId, name: file.path, receivedBytes: 0,
        phase: file.action === "skip" ? previous?.files.find(item => item.id === file.mediaId)?.phase === "saved" ? "saved" : "skipped" : file.action === "link" ? "linked" : "waiting" })) };
    const index = task.notes.findIndex(item => item.key === note.key);
    if (index < 0) task.notes.push(note); else task.notes[index] = note;
    await this.persist();
  }
  progress(context: ImportTaskContext, key: string, mediaId: string, progress: DownloadProgress, phase: "downloading" | "saving"): void {
    const task = this.tasks.find(item => item.id === context.id);
    const file = task?.notes.find(note => note.key === key)?.files.find(item => item.id === mediaId);
    if (!task || !file || context.signal.aborted) return;
    Object.assign(file, progress, { phase }); task.phase = phase;
    if (Date.now() - this.lastProgress > 100 || phase === "saving") { this.lastProgress = Date.now(); this.emit(); }
  }
  async attachment(context: ImportTaskContext, key: string, result: VaultWriteResult["attachments"][number]): Promise<void> {
    const task = this.tasks.find(item => item.id === context.id)!;
    const file = task.notes.find(note => note.key === key)?.files.find(item => item.id === result.mediaId);
    if (!file) return;
    file.phase = file.phase === "saved" && result.status === "skipped" ? "saved"
      : context.signal.aborted && result.status === "failed" ? "cancelled" : result.status;
    file.error = result.error;
    await this.persist();
  }
  async endNote(context: ImportTaskContext, key: string, write?: VaultWriteResult, error?: unknown): Promise<void> {
    const task = this.tasks.find(item => item.id === context.id)!;
    const note = task.notes.find(item => item.key === key)!;
    note.phase = context.signal.aborted ? "cancelled" : !write || write.ledger.completion === "partial" ? "failed" : write.ledger.status === "skipped_duplicate" ? "skipped" : "saved";
    for (const file of note.files) {
      const result = write?.attachments.find(item => item.mediaId === file.id);
      file.phase = file.phase === "saved" && result?.status === "skipped" ? "saved"
        : context.signal.aborted && result?.status !== "saved" && result?.status !== "skipped" && result?.status !== "linked" ? "cancelled" : result?.status ?? "failed";
      file.error = result?.error ?? (error instanceof Error ? error.message : undefined);
    }
    if (note.phase === "failed") task.lastFailureAt = new Date().toISOString();
    await this.persist();
  }
}
