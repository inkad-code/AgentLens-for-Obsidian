import type { SchedulerLease, WriteResultsRequest } from "../api/AgentLensApiClient";
import type { MediaPolicy, PendingAction } from "../core/domain";
import { AgentLensError } from "../core/errors";
import { redactPersistentUrl } from "../core/urls";
import type { PluginStateStore } from "../runtime/PluginStateStore";
import type { NoteWriteManifest } from "../vault/VaultWriter";
import type { PreviewResult } from "./types";

const MAX_PENDING_ACTIONS = 500;

export interface SchedulerCheckpoint {
  id: string;
  manualStart?: boolean;
  attempted?: boolean;
  terminal?: { status: "failed" | "coverage_incomplete"; recordedAt: string };
  accountId: string;
  installationId: string;
  lease: SchedulerLease;
  cursor: string | null;
  pageNumber: number;
  requestId: string;
  idempotencyKey: string;
}

export interface RemoteAction {
  id: string;
  operationKey: string;
  idempotencyKey: string;
  requestId: string;
}

export interface PendingCallback {
  id: string;
  request: WriteResultsRequest;
  idempotencyKey: string;
}

export interface PendingWrite {
  id: string;
  preview: PreviewResult;
  options: { folderPath: string; templateId: "default" | "compact"; mediaPolicy: MediaPolicy; notePath?: string; saveAsCopy?: boolean };
  request?: WriteResultsRequest | undefined;
  idempotencyKey?: string | undefined;
}

export class DurableActionStore {
  constructor(
    private readonly stateStore: PluginStateStore,
    private readonly createId: () => string
) {}

  async schedulerCheckpoints(accountId: string, includeTerminal = false): Promise<SchedulerCheckpoint[]> {
    const state = await this.stateStore.load();
    return state.pendingActions.flatMap((action) => {
      if (action.kind !== "scheduler_checkpoint") return [];
      const checkpoint = parseSchedulerCheckpoint(action);
      if (!checkpoint) throw new Error("Stored scheduler continuation is invalid; recovery requires reconciliation.");
      return checkpoint.accountId === accountId && checkpoint.installationId === state.installationId
        && (includeTerminal || !checkpoint.terminal) ? [checkpoint] : [];
    });
  }

  async prepareSchedulerCheckpoint(accountId: string, lease: SchedulerLease, cursor: string | null = null,
    pageNumber = 1, manualStart = false): Promise<SchedulerCheckpoint> {
    let selected: SchedulerCheckpoint | undefined;
    await this.stateStore.update((state) => {
      const id = `scheduler:${JSON.stringify([accountId, state.installationId, lease.creatorId, lease.leaseId])}`;
      const existing = state.pendingActions.find((action) => {
        if (action.kind !== "scheduler_checkpoint") return false;
        const pending = parseSchedulerCheckpoint(action);
        return action.id === id || (pending?.accountId === accountId && pending.installationId === state.installationId
          && pending.lease.creatorId === lease.creatorId
          && (pending.lease.leaseId === lease.leaseId || (lease.trigger === "manual_check" && !pending.terminal && pending.lease.trigger === "manual_check")));
      });
      if (existing) {
        selected = parseSchedulerCheckpoint(existing) ?? undefined;
        if (!selected) throw new Error("Stored scheduler continuation is invalid; recovery requires reconciliation.");
        return;
      }
      selected = { id, attempted: false, accountId, installationId: state.installationId, lease: structuredClone(lease), cursor, pageNumber,
        requestId: this.createId(), idempotencyKey: manualStart ? `creator-manual-${lease.leaseId}` : `auto-${lease.leaseId}-${pageNumber}`,
        ...(manualStart ? { manualStart: true } : {}) };
      state.pendingActions.push({ id, kind: "scheduler_checkpoint", createdAt: new Date().toISOString(), payload: selected });
      trimPendingActions(state);
    });
    if (!selected) throw new Error("Scheduler continuation was not persisted.");
    return selected;
  }

  async markSchedulerTerminal(current: SchedulerCheckpoint, status: "failed" | "coverage_incomplete"): Promise<void> {
    await this.stateStore.update((state) => {
      const index = state.pendingActions.findIndex((action) => action.id === current.id && action.kind === "scheduler_checkpoint");
      const stored = index < 0 ? null : parseSchedulerCheckpoint(state.pendingActions[index]!);
      if (!stored || stored.requestId !== current.requestId || stored.pageNumber !== current.pageNumber
        || stored.installationId !== state.installationId) throw new Error("Scheduler continuation changed; reconcile before recording failure.");
      state.pendingActions[index] = { ...state.pendingActions[index]!, payload: {
        ...stored, terminal: { status, recordedAt: new Date().toISOString() }
      } };
    });
  }

  async markSchedulerAttempted(current: SchedulerCheckpoint): Promise<SchedulerCheckpoint> {
    const attempted = { ...current, attempted: true };
    await this.stateStore.update((state) => {
      const index = state.pendingActions.findIndex((action) => action.id === current.id && action.kind === "scheduler_checkpoint");
      const stored = index < 0 ? null : parseSchedulerCheckpoint(state.pendingActions[index]!);
      if (!stored || stored.requestId !== current.requestId || stored.pageNumber !== current.pageNumber
        || stored.installationId !== state.installationId) throw new Error("Scheduler continuation changed; reconcile before dispatch.");
      state.pendingActions[index] = { ...state.pendingActions[index]!, payload: attempted };
    });
    return attempted;
  }

  async advanceSchedulerCheckpoint(current: SchedulerCheckpoint, cursor: string | null, lease = current.lease): Promise<SchedulerCheckpoint | null> {
    const next: SchedulerCheckpoint | null = cursor === null ? null : {
      ...current, attempted: false, manualStart: false, lease, cursor, pageNumber: current.pageNumber + 1,
      requestId: this.createId(), idempotencyKey: `auto-${lease.leaseId}-${current.pageNumber + 1}`
    };
    await this.stateStore.update((state) => {
      const index = state.pendingActions.findIndex((action) => action.id === current.id && action.kind === "scheduler_checkpoint");
      const stored = index < 0 ? null : parseSchedulerCheckpoint(state.pendingActions[index]!);
      if (!stored || stored.requestId !== current.requestId || stored.pageNumber !== current.pageNumber
        || stored.installationId !== state.installationId) throw new Error("Scheduler continuation changed; reconcile before continuing.");
      if (next) state.pendingActions[index] = { ...state.pendingActions[index]!, payload: next };
      else state.pendingActions.splice(index, 1);
    });
    return next;
  }

  async runRemoteAction<T>(
    operationKey: string,
    idempotencyPrefix: string,
    execute: (action: RemoteAction) => Promise<T>,
    options: { retainIdentityOnFailure?: boolean } = {}
): Promise<T> {
    const action = await this.getOrCreateRemoteAction(operationKey, idempotencyPrefix);
    try {
      const result = await execute(action);
      await this.remove([action.id]);
      return result;
    } catch (error) {
      if (!options.retainIdentityOnFailure && error instanceof AgentLensError && !error.retryable && error.execution?.failureClass !== "reconciliation_required") await this.remove([action.id]);
      throw error;
    }
  }

  async pendingCallbacks(): Promise<PendingCallback[]> {
    return (await this.stateStore.load()).pendingActions.flatMap((action) => {
      if (action.kind !== "result_callback") return [];
      const callback = parseCallback(action);
      return callback ? [{ id: action.id, ...callback }] : [];
    });
  }

  async queueCallback(request: WriteResultsRequest, idempotencyKey: string, completedWriteIds: readonly string[] = []): Promise<void> {
    const action: PendingAction = {
      id: this.createId(),
      kind: "result_callback",
      createdAt: new Date().toISOString(),
      payload: { request, idempotencyKey }
    };
    await this.stateStore.update((state) => {
      const completed = new Set(completedWriteIds);
      state.pendingActions = state.pendingActions.filter((pending) => pending.kind !== "write_manifest" || !completed.has(pending.id));
      const duplicate = state.pendingActions.some((pending) =>
        pending.kind === "result_callback" && parseCallback(pending)?.idempotencyKey === idempotencyKey
);
      if (!duplicate) state.pendingActions.push(action);
      trimPendingActions(state);
    });
  }

  async clearCallback(idempotencyKey: string): Promise<void> {
    await this.stateStore.update((state) => {
      state.pendingActions = state.pendingActions.filter((action) =>
        action.kind !== "result_callback" || parseCallback(action)?.idempotencyKey !== idempotencyKey
);
    });
  }

  async removeCallbacks(ids: Iterable<string>): Promise<void> {
    await this.removeByKind(ids, "result_callback");
  }

  async pendingWrites(): Promise<PendingWrite[]> {
    return (await this.stateStore.load()).pendingActions.flatMap((action) => {
      if (action.kind !== "write_manifest") return [];
      const write = parseWrite(action);
      return write ? [{ id: action.id, ...write }] : [];
    });
  }

  async prepareWrite(
    preview: PreviewResult,
    options: PendingWrite["options"],
    request?: WriteResultsRequest,
    idempotencyKey?: string
): Promise<string> {
    const action: PendingAction = {
      id: this.createId(),
      kind: "write_manifest",
      createdAt: new Date().toISOString(),
      payload: {
        preview: sanitizePreviewForPersistence(preview),
        options,
        ...(request ? { request } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    };
    let actionId = action.id;
    await this.stateStore.update((state) => {
      const duplicate = idempotencyKey ? state.pendingActions.find((pending) =>
        pending.kind === "write_manifest" && parseWrite(pending)?.idempotencyKey === idempotencyKey
) : undefined;
      if (duplicate) actionId = duplicate.id;
      else state.pendingActions.push(action);
      trimPendingActions(state);
    });
    return actionId;
  }

  async markWriteFailed(actionId: string, preview: PreviewResult, manifest: NoteWriteManifest): Promise<void> {
    await this.stateStore.update((state) => {
      const recordedAt = new Date().toISOString();
      const existing = state.ledger[manifest.contentKey];
      // A failed extra manual copy must not replace the receipt for a note
      // that was already saved successfully.
      if (manifest.saveAsCopy && existing && existing.status !== "failed") return;
      state.ledger[manifest.contentKey] = {
        destination: "obsidian",
        contentKey: manifest.contentKey,
        contentId: preview.post.contentId,
        ...(preview.fetchId ? { fetchId: preview.fetchId } : {}),
        effectivePostKey: manifest.contentKey,
        notePath: manifest.notePath,
        attachmentPaths: [],
        media: manifest.attachments.map((attachment) => ({
          mediaKey: `${manifest.contentKey}:media:${attachment.mediaId}`,
          path: attachment.path,
          status: "failed"
        })),
        ...(preview.monitoringInstanceId ? { monitoringInstanceId: preview.monitoringInstanceId } : {}),
        sourceUrl: redactPersistentUrl(preview.post.canonicalUrl),
        mediaPolicy: manifest.mediaPolicy,
        writtenAt: recordedAt,
        firstWrittenAt: existing?.firstWrittenAt ?? existing?.writtenAt ?? recordedAt,
        lastVerifiedAt: recordedAt,
        physicalStatus: "missing",
        lastActionId: actionId,
        managedDigest: manifest.managedDigest,
        status: "failed",
        completion: "partial",
        error: "VAULT_WRITE_FAILED"
      };
    });
  }

  async removeWrites(ids: Iterable<string>): Promise<void> {
    await this.removeByKind(ids, "write_manifest");
  }

  async remove(ids: Iterable<string>): Promise<void> {
    const completed = new Set(ids);
    if (completed.size === 0) return;
    await this.stateStore.update((state) => {
      state.pendingActions = state.pendingActions.filter((action) => !completed.has(action.id));
    });
  }

  private async removeByKind(ids: Iterable<string>, kind: PendingAction["kind"]): Promise<void> {
    const completed = new Set(ids);
    if (completed.size === 0) return;
    await this.stateStore.update((state) => {
      state.pendingActions = state.pendingActions.filter((action) => action.kind !== kind || !completed.has(action.id));
    });
  }

  async getOrCreateRemoteAction(operationKey: string, idempotencyPrefix: string): Promise<RemoteAction> {
    let selected: RemoteAction | undefined;
    const candidate: RemoteAction = {
      id: `remote-${this.createId()}`,
      operationKey,
      idempotencyKey: `${idempotencyPrefix}-${this.createId()}`,
      requestId: this.createId()
    };
    await this.stateStore.update((state) => {
      const existing = state.pendingActions
        .filter((action) => action.kind === "remote_action")
        .map(parseRemoteAction)
        .find((action) => action?.operationKey === operationKey);
      if (existing) selected = existing;
      else {
        selected = candidate;
        state.pendingActions.push({
          id: candidate.id,
          kind: "remote_action",
          createdAt: new Date().toISOString(),
          payload: {
            operationKey: candidate.operationKey,
            idempotencyKey: candidate.idempotencyKey,
            requestId: candidate.requestId
          }
        });
        trimPendingActions(state);
      }
    });
    return selected ?? candidate;
  }
}

function parseCallback(action: PendingAction): Omit<PendingCallback, "id"> | null {
  if (!isRecord(action.payload)) return null;
  const { request, idempotencyKey } = action.payload;
  if (!isWriteResultsRequest(request) || typeof idempotencyKey !== "string") return null;
  return { request, idempotencyKey };
}

function parseSchedulerCheckpoint(action: PendingAction): SchedulerCheckpoint | null {
  if (!isRecord(action.payload)) return null;
  const p = action.payload;
  if (p.id !== action.id || typeof p.accountId !== "string" || !p.accountId
    || typeof p.installationId !== "string" || !p.installationId
    || !Number.isSafeInteger(p.pageNumber) || Number(p.pageNumber) < 1
    || (p.cursor !== null && (typeof p.cursor !== "string" || !p.cursor))
    || typeof p.requestId !== "string" || !p.requestId || typeof p.idempotencyKey !== "string" || !p.idempotencyKey
    || !isRecord(p.lease)) return null;
  if (p.manualStart !== undefined && (typeof p.manualStart !== "boolean" || (p.manualStart && p.pageNumber !== 1))) return null;
  if (p.attempted !== undefined && typeof p.attempted !== "boolean") return null;
  if (p.terminal !== undefined && (!isRecord(p.terminal)
    || !["failed", "coverage_incomplete"].includes(String(p.terminal.status))
    || typeof p.terminal.recordedAt !== "string" || !Number.isFinite(Date.parse(p.terminal.recordedAt)))) return null;
  const lease = p.lease;
  if (!["creatorId", "leaseId", "trigger", "saveFolderPath", "schedulerState"].every((key) => typeof lease[key] === "string" && lease[key])
    || !["default", "compact"].includes(String(lease.noteTemplateId))
    || !["download_all", "download_images_only", "link_only"].includes(String(lease.mediaPolicy))
    || (lease.nextCheckAt !== null && typeof lease.nextCheckAt !== "string")) return null;
  return p as unknown as SchedulerCheckpoint;
}

function parseRemoteAction(action: PendingAction): RemoteAction | null {
  if (action.kind !== "remote_action" || !isRecord(action.payload)) return null;
  const { operationKey, idempotencyKey, requestId } = action.payload;
  if (typeof operationKey !== "string" || typeof idempotencyKey !== "string" || typeof requestId !== "string") return null;
  return { id: action.id, operationKey, idempotencyKey, requestId };
}

function parseWrite(action: PendingAction): Omit<PendingWrite, "id"> | null {
  if (!isRecord(action.payload)) return null;
  const { preview, options, request, idempotencyKey } = action.payload;
  if (!isPreviewResult(preview) || !isWriteOptions(options)
      || (request !== undefined && !isWriteResultsRequest(request))
      || (idempotencyKey !== undefined && typeof idempotencyKey !== "string")
      || (request === undefined) !== (idempotencyKey === undefined)) return null;
  return {
    preview,
    options,
    ...(request ? { request } : {}),
    ...(typeof idempotencyKey === "string" ? { idempotencyKey } : {})
  };
}

function isWriteResultsRequest(value: unknown): value is WriteResultsRequest {
  return isRecord(value) && typeof value.runId === "string" && Array.isArray(value.results);
}

function isPreviewResult(value: unknown): value is PreviewResult {
  return isRecord(value) && typeof value.demo === "boolean" && isRecord(value.post)
    && typeof value.post.platform === "string" && typeof value.post.contentId === "string"
    && typeof value.post.canonicalUrl === "string" && isRecord(value.post.author)
    && typeof value.post.author.id === "string" && typeof value.post.author.displayName === "string"
    && Array.isArray(value.post.media);
}

function isWriteOptions(value: unknown): value is PendingWrite["options"] {
  return isRecord(value) && typeof value.folderPath === "string"
    && (value.templateId === "default" || value.templateId === "compact")
    && (value.mediaPolicy === "download_all" || value.mediaPolicy === "download_images_only" || value.mediaPolicy === "link_only")
    && (value.notePath === undefined || typeof value.notePath === "string")
    && (value.saveAsCopy === undefined || typeof value.saveAsCopy === "boolean");
}

function sanitizePreviewForPersistence(preview: PreviewResult): PreviewResult {
  return {
    ...preview,
    post: {
      ...preview.post,
      media: preview.post.media.map((media) => ({
        ...media,
        downloadHeaders: undefined,
        sourceUrl: redactPersistentUrl(media.sourceUrl, media.downloadUrlExpiresAt),
        ...(media.thumbnailUrl ? { thumbnailUrl: redactPersistentUrl(media.thumbnailUrl, media.thumbnailExpiresAt) } : {}),
        ...(media.coverUrl ? { coverUrl: redactPersistentUrl(media.coverUrl) } : {})
      }))
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimPendingActions(state: { pendingActions: PendingAction[] }): void {
  if (state.pendingActions.length > MAX_PENDING_ACTIONS) {
    throw new Error("Pending recovery queue is full. Sync pending work before starting another operation.");
  }
}
