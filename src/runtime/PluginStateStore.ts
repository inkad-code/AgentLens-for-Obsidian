import type { PendingAction, PersistedLedgerEntry } from "../core/domain";

export interface CreatorDiagnostics {
  lastSavedAt: string;
  lastSavedCount: number;
  lastSavedFetchRunId: string;
  countedPages: string[];
  savedKeysByPage?: Record<string, string[]>;
}

export interface PluginUiPreferences {
  recentFolder?: string | undefined;
  dismissedUpdateVersion?: string | undefined;
  onboardingVersion?: number | undefined;
}

export interface PluginDataAdapter {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

export interface AgentLensPluginState {
  schemaVersion: 1;
  installationId: string;
  refreshTokenSecretId?: string | undefined;
  ledger: Record<string, PersistedLedgerEntry>;
  noteKeysByPath?: Record<string, string> | undefined;
  pendingActions: PendingAction[];
  creatorDiagnostics: Record<string, CreatorDiagnostics>;
  uiPreferences: PluginUiPreferences;
}

interface PluginDataEnvelope {
  agentlensState?: unknown;
  [key: string]: unknown;
}

export class PluginStateStore {
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(state: Readonly<AgentLensPluginState>) => void>();

  constructor(
    private readonly adapter: PluginDataAdapter,
    private readonly createInstallationId: () => string = () => crypto.randomUUID()
  ) {}

  async load(): Promise<AgentLensPluginState> {
    const envelope = asEnvelope(await this.adapter.loadData());
    const state = envelope.agentlensState;
    if (isValidState(state)) return this.publish(state);

    const initial = recoverState(state, this.createInstallationId);
    await this.save(initial, envelope);
    return this.publish(initial);
  }

  subscribe(listener: (state: Readonly<AgentLensPluginState>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async readRoot(): Promise<Record<string, unknown>> {
    return structuredClone(asEnvelope(await this.adapter.loadData()));
  }

  async patchRoot(patch: Readonly<Record<string, unknown>>): Promise<void> {
    const task = this.writeQueue.then(async () => {
      const envelope = asEnvelope(await this.adapter.loadData());
      await this.adapter.saveData({ ...envelope, ...patch });
    });
    this.writeQueue = task.catch(() => undefined);
    await task;
  }

  async update(mutator: (state: AgentLensPluginState) => void): Promise<AgentLensPluginState> {
    let updated: AgentLensPluginState | undefined;
    const task = this.writeQueue.then(async () => {
      const envelope = asEnvelope(await this.adapter.loadData());
      const state = envelope.agentlensState;
      const current = isValidState(state)
        ? structuredClone(state)
        : recoverState(state, this.createInstallationId);
      mutator(current);
      await this.save(current, envelope);
      updated = structuredClone(current);
    });
    this.writeQueue = task.catch(() => undefined);
    await task;
    if (!updated) throw new Error("Plugin state update did not complete.");
    return this.publish(updated);
  }

  async recordCreatorSavedPage(
    creatorId: string,
    fetchRunId: string,
    fetchId: string,
    savedCount: number,
    savedAt: string,
    savedContentKeys?: readonly string[]
  ): Promise<void> {
    if (!creatorId || !fetchRunId || !fetchId || savedCount < 1) return;
    const pageKey = `${fetchRunId}:${fetchId}`;
    await this.update((state) => {
      const current = state.creatorDiagnostics[creatorId];
      const sameRun = current?.lastSavedFetchRunId === fetchRunId;
      const alreadyCounted = sameRun && current.countedPages.includes(pageKey);
      const previousKeys = sameRun ? current.savedKeysByPage?.[pageKey] : undefined;
      // Legacy counts have no content identities; keep their page replay idempotent.
      if (alreadyCounted && (!savedContentKeys || !previousKeys)) return;
      const keys = savedContentKeys ? [...new Set(savedContentKeys)] : undefined;
      const added = keys ? keys.filter((key) => !previousKeys?.includes(key)).length : savedCount;
      if (added < 1) return;
      const countedPages = [...new Set([...(sameRun ? current.countedPages : []), pageKey])].slice(-50);
      const savedKeysByPage = { ...(sameRun ? current.savedKeysByPage : {}) };
      if (keys) savedKeysByPage[pageKey] = [...new Set([...(previousKeys ?? []), ...keys])];
      state.creatorDiagnostics[creatorId] = {
        lastSavedAt: savedAt,
        lastSavedCount: (sameRun ? current.lastSavedCount : 0) + added,
        lastSavedFetchRunId: fetchRunId,
        countedPages,
        ...(Object.keys(savedKeysByPage).length ? {
          savedKeysByPage: Object.fromEntries(Object.entries(savedKeysByPage).filter(([key]) => countedPages.includes(key)))
        } : {})
      };
    });
  }

  async mergeCreatorDiagnostics<T extends { creatorId: string }>(creators: readonly T[]): Promise<Array<T & {
    lastSavedAt?: string;
    lastSavedCount?: number;
    lastSavedFetchRunId?: string;
  }>> {
    const diagnostics = (await this.load()).creatorDiagnostics;
    return creators.map((creator) => {
      const local = diagnostics[creator.creatorId];
      return local ? {
        ...creator,
        lastSavedAt: local.lastSavedAt,
        lastSavedCount: local.lastSavedCount,
        lastSavedFetchRunId: local.lastSavedFetchRunId
      } : { ...creator };
    });
  }

  async uiPreferences(): Promise<PluginUiPreferences> {
    return structuredClone((await this.load()).uiPreferences);
  }

  async patchUiPreferences(patch: Readonly<PluginUiPreferences>): Promise<void> {
    await this.update((state) => {
      state.uiPreferences = { ...state.uiPreferences, ...patch };
    });
  }

  private publish(state: AgentLensPluginState): AgentLensPluginState {
    const snapshot = structuredClone(state);
    this.listeners.forEach((listener) => listener(structuredClone(snapshot)));
    return structuredClone(snapshot);
  }

  private async save(state: AgentLensPluginState, envelope?: PluginDataEnvelope): Promise<void> {
    await this.adapter.saveData({ ...(envelope ?? {}), agentlensState: state });
  }
}

function asEnvelope(value: unknown): PluginDataEnvelope {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as PluginDataEnvelope
    : {};
}

function isValidState(value: unknown): value is AgentLensPluginState {
  if (!isRecord(value) || value.schemaVersion !== 1
      || typeof value.installationId !== "string" || !value.installationId.trim()
      || !isRecord(value.ledger) || !Array.isArray(value.pendingActions)) return false;
  return value.pendingActions.every(isPendingAction)
    && (value.noteKeysByPath === undefined || (isRecord(value.noteKeysByPath)
      && Object.values(value.noteKeysByPath).every((key) => typeof key === "string")))
    && isCreatorDiagnosticsMap(value.creatorDiagnostics)
    && isUiPreferences(value.uiPreferences);
}

function isUiPreferences(value: unknown): value is PluginUiPreferences {
  return isRecord(value)
    && (value.recentFolder === undefined || typeof value.recentFolder === "string")
    && (value.dismissedUpdateVersion === undefined || typeof value.dismissedUpdateVersion === "string")
    && (value.onboardingVersion === undefined || (typeof value.onboardingVersion === "number" && value.onboardingVersion >= 0));
}

function isCreatorDiagnosticsMap(value: unknown): value is Record<string, CreatorDiagnostics> {
  return isRecord(value) && Object.values(value).every((entry) => isRecord(entry)
    && typeof entry.lastSavedAt === "string"
    && typeof entry.lastSavedCount === "number"
    && entry.lastSavedCount >= 0
    && typeof entry.lastSavedFetchRunId === "string"
    && Array.isArray(entry.countedPages)
    && entry.countedPages.every((item) => typeof item === "string")
    && (entry.savedKeysByPage === undefined || (isRecord(entry.savedKeysByPage)
      && Object.values(entry.savedKeysByPage).every((keys) => Array.isArray(keys)
        && keys.every((key) => typeof key === "string")))));
}

function isPendingAction(value: unknown): value is PendingAction {
  return isRecord(value)
    && typeof value.id === "string"
    && ["write_manifest", "result_callback", "media_retry", "remote_action", "scheduler_checkpoint"].includes(String(value.kind))
    && typeof value.createdAt === "string"
    && "payload" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recoverState(
  value: unknown,
  createInstallationId: () => string
): AgentLensPluginState {
  const state = isRecord(value) ? value : {};
  return {
    schemaVersion: 1,
    installationId: typeof state.installationId === "string" && state.installationId.trim()
      ? state.installationId
      : createInstallationId(),
    ...(typeof state.refreshTokenSecretId === "string" && state.refreshTokenSecretId.trim()
      ? { refreshTokenSecretId: state.refreshTokenSecretId }
      : {}),
    ledger: isRecord(state.ledger) ? state.ledger as Record<string, PersistedLedgerEntry> : {},
    ...(isRecord(state.noteKeysByPath) ? { noteKeysByPath: Object.fromEntries(Object.entries(state.noteKeysByPath)
      .filter(([, key]) => typeof key === "string")) as Record<string, string> } : {}),
    pendingActions: Array.isArray(state.pendingActions)
      ? state.pendingActions.filter(isPendingAction)
      : [],
    creatorDiagnostics: isCreatorDiagnosticsMap(state.creatorDiagnostics)
      ? structuredClone(state.creatorDiagnostics)
      : {},
    uiPreferences: isUiPreferences(state.uiPreferences) ? structuredClone(state.uiPreferences) : {}
  };
}
