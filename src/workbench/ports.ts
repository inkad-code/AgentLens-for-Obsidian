import type { ManualSaveOptions } from "./types";
import type { DownloadProgress, ImportTaskPort } from "./ImportTasks";
import type { ScheduleHistoryPage } from "../api/scheduleHistory";
import type {
  AccountSummary,
  AccountFollow,
  AutoFetchCapabilities,
  ActivityDetail,
  ActivityExport,
  ActivityFilters,
  ActivityPage,
  CreatorParseResult,
  CreatorRecord,
  CreatorSchedulePreview,
  CreatorSettingsInput,
  CreatorUpdatePage,
  DeleteCreatorResult,
  FetchPage,
  SchedulerLease,
  WriteResultsRequest,
  SchedulerReconcileReason
} from "../api/AgentLensApiClient";
import type { AccountCapabilities, PublicPlatformCatalog } from "../api/contracts";
import type { ExecutionOperation, ExecutionRecovery } from "../api/executions";
import type { AuthState } from "../auth/AuthService";
import type { NormalizedMedia } from "../core/domain";
import type { NoteWriteManifest } from "../vault/VaultWriter";
import type {
  BatchSaveResult,
  FollowCreatorInput,
  PreparedSave,
  PreviewResult,
  SchedulerRunResult,
  WriteOptions
} from "./types";
import type { PluginUiPreferences } from "../runtime/PluginStateStore";
import type { BillingPort } from "../api/billing";

export interface AgentLensApiPort {
  reportDestinationFailure?(token: string, input: {creatorId: string; operationId: string; trigger: string; plan?: import("../api/scheduleHistory").OperationPlan}): Promise<unknown>;
  sharedSettings?(token: string): Promise<import("../api/shared-settings").SharedSettings[]>;
  adoptSharedFolder?(token: string, input: {followId: string; targetId: string; pathRevision: number; folderId: string}): Promise<unknown>;
  restoreHistory?(accessToken: string, fetchId: string): Promise<FetchPage>;
  registerDestination?(token: string, input: import("../api/nativeDestinations").DestinationRegistration): Promise<unknown>;
  pendingDestinations?(token: string, targetId: string): Promise<import("../api/nativeDestinations").DestinationBinding[]>;
  adoptDestination?(token: string, binding: import("../api/nativeDestinations").DestinationBinding): Promise<unknown>;
  deleteAccountFollowCommand?(accessToken: string, followId: string, idempotencyKey: string): Promise<void>;
  patchAccountFollow?(accessToken: string, followId: string, patch: import("../runtime/FollowConfigurationOutbox").FollowConfigurationPatch, idempotencyKey: string): Promise<void>;
  followChanges?(accessToken: string, after?: number, through?: number): Promise<import("../api/followSync").FollowChangePage>;
  supplementContent?(accessToken: string, fetchId: string, post: import("../core/domain").NormalizedPost): Promise<import("../core/domain").NormalizedPost>;
  demoFetch?(mode: "single_post" | "profile_page", cursor?: string | null): Promise<FetchPage>;
  billing?(accessToken: string): BillingPort;
  unfollowAccount(accessToken: string, followId: string): Promise<void>;
  accountFollows(accessToken: string): Promise<readonly AccountFollow[]>;
  scheduleHistory(accessToken: string, followId: string, afterRevision?: number, throughRevision?: number): Promise<ScheduleHistoryPage>;
  getExecution(accessToken: string, operationId: string): Promise<ExecutionOperation>;
  inspectExecutionRecovery(accessToken: string, creatorId: string, operationId: string): Promise<ExecutionRecovery>;
  resumeUnstartedExecution(accessToken: string, creatorId: string, operationId: string, configRevision: number): Promise<ExecutionRecovery>;
  requestPasswordReset?(email: string): Promise<string>;
  autoFetchCapabilities(accessToken: string): Promise<AutoFetchCapabilities>;
  currentClientVersion(): string;
  publicPlatformCatalog?(): Promise<PublicPlatformCatalog>;
  capabilities(accessToken: string): Promise<AccountCapabilities>;
  account(accessToken: string): Promise<AccountSummary>;
  activity(accessToken: string, filters?: ActivityFilters, cursor?: string | null, pageSize?: number, through?: string): Promise<ActivityPage>;
  activityDetail(accessToken: string, activityId: string): Promise<ActivityDetail>;
  exportActivity(accessToken: string, filters?: ActivityFilters): Promise<ActivityExport>;
  settings(accessToken: string): Promise<{ homeTimezone: string | null; confirmed: boolean }>;
  confirmTimezone(accessToken: string, timezone: string): Promise<{ homeTimezone: string }>;
  parseCreator(accessToken: string, profileUrl: string, idempotencyKey: string): Promise<CreatorParseResult>;
  createCreator(accessToken: string, input: FollowCreatorInput, idempotencyKey: string): Promise<CreatorRecord>;
  listCreators(accessToken: string): Promise<readonly CreatorRecord[]>;
  updateCreator(accessToken: string, creatorId: string, enabled: boolean, idempotencyKey: string): Promise<CreatorRecord>;
  previewCreatorSettings(accessToken: string, creatorId: string, input: CreatorSettingsInput): Promise<CreatorSchedulePreview>;
  updateCreatorSettings(accessToken: string, creatorId: string, input: CreatorSettingsInput, previewToken: string, idempotencyKey: string): Promise<CreatorRecord>;
  deleteCreator(accessToken: string, creatorId: string, idempotencyKey: string): Promise<DeleteCreatorResult>;
  fetch(accessToken: string, input: { url: string; mode: "single_post" | "profile_page"; cursor?: string; pageSize?: number }, idempotencyKey: string, requestId: string): Promise<FetchPage>;
  baselineImport(accessToken: string, creatorId: string, requestId: string, idempotencyKey: string): Promise<FetchPage>;
  reconcile(accessToken: string, reason: SchedulerReconcileReason, requestId: string, idempotencyKey: string): Promise<{ serverTime: string; leases: readonly SchedulerLease[] }>;
  manualCreatorUpdates(accessToken: string, creatorId: string, requestId: string, idempotencyKey: string): Promise<CreatorUpdatePage>;
  creatorUpdates(accessToken: string, lease: SchedulerLease, cursor: string | null, requestId: string, idempotencyKey: string): Promise<CreatorUpdatePage>;
  refreshMedia(accessToken: string, contentId: string, mediaIds: readonly string[], idempotencyKey: string): Promise<readonly NormalizedMedia[]>;
  writeResults(accessToken: string, input: WriteResultsRequest, idempotencyKey: string): Promise<{ accepted: number; success: number; partial: number; failed: number; skipped: number }>;
}

export interface MediaDownloaderPort {
  readonly streaming?: boolean;
  readonly refreshOnFailure?: boolean;
  readonly waitForTransferSlot?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  download(media: NormalizedMedia, signal?: AbortSignal, onProgress?: (progress: DownloadProgress) => void, lease?: import("../runtime/TransferPool").TransferLease): Promise<import("../vault/DownloadedMedia").DownloadedMedia>;
}

export interface SessionWorkbenchPort {
  billing?: BillingPort;
  cancelManualSaves?(): void;
  isManualSaving?(): boolean;
  authState(): Readonly<AuthState>;
  clientVersion(): string;
  subscribeAuth(listener: (state: Readonly<AuthState>) => void): () => void;
  restoreAuth(force?: boolean): Promise<AuthState>;
  cancelPendingSignIn?(): Promise<void>;
  startSignIn(provider?: "google", intent?: import("../auth/AuthService").DeviceAuthorizationIntent): Promise<AuthState>;
  requestPasswordReset?(email: string): Promise<string>;
  signInWithEmail?(credentials: import("../auth/AuthService").EmailCredentials): Promise<AuthState>;
  pollSignIn(): Promise<AuthState>;
  signOut(): Promise<void>;
  publicPlatformCatalog?(): Promise<PublicPlatformCatalog>;
  capabilities(): Promise<AccountCapabilities>;
  account(): Promise<AccountSummary>;
  subscribeAccountChanges?(listener: () => void): () => void;
  uiPreferences?(): Promise<PluginUiPreferences>;
  setUiPreferences?(patch: Readonly<PluginUiPreferences>): Promise<void>;
}

export interface ActivityWorkbenchPort {
  activity(filters: ActivityFilters, cursor?: string | null, through?: string): Promise<ActivityPage>;
  activityDetail(activityId: string): Promise<ActivityDetail>;
  exportActivity(filters: ActivityFilters): Promise<ActivityExport>;
}

export interface SingleWorkbenchPort {
  clientVersion(): string;
  previewSingle(url: string): Promise<PreviewResult>;
  planPreview(preview: PreviewResult, options?: WriteOptions): Promise<NoteWriteManifest>;
  savePrepared(prepared: readonly PreparedSave[], onProgress?: ((contentKey: string, status: string) => void), options?: ManualSaveOptions): Promise<BatchSaveResult>;
}

export interface BulkWorkbenchPort {
  restoreHistory?(fetchId: string): Promise<FetchPage>;
  supplementContent?(preview: PreviewResult): Promise<PreviewResult>;
  previewSingle(url: string): Promise<PreviewResult>;
  clientVersion(): string;
  fetchProfilePage(url: string, cursor: string | null): Promise<FetchPage>;
  planPreview(preview: PreviewResult, options?: WriteOptions): Promise<NoteWriteManifest>;
  savePrepared(prepared: readonly PreparedSave[], onProgress?: ((contentKey: string, status: string) => void), options?: ManualSaveOptions): Promise<BatchSaveResult>;
}

export interface AutoFetchWorkbenchPort {
  subscribeFollowConfiguration?(listener: (ids: string[]) => void): () => void;
  queueFollowDeletion?(followId: string): Promise<string>;
  queueFollowConfiguration?(followId: string, patch: import("../runtime/FollowConfigurationOutbox").FollowConfigurationPatch): Promise<string>;
  exportLocalDiagnostics?(): Promise<import("../diagnostics/export").DiagnosticPackage>;
  autoFetchTaskHistory?(creatorId: string, folderPath: string, after?: { sequence: number }): Promise<import("../auto-fetch/operation-store").TaskHistoryPage>;
  autoFetchTaskDetail?(creatorId: string, folderPath: string, operationId: string, after?: { pageNumber: number }): Promise<import("../auto-fetch/operation-store").TaskDetailPage | undefined>;
  refreshAutoFetchCreators?(creators: readonly CreatorRecord[]): Promise<readonly CreatorRecord[]>;
  autoFetchActivity?(creatorId: string, folderPath?: string): import("./AutoFetchActivity").AutoFetchActivity;
  subscribeAutoFetchActivity?(listener: () => void): () => void;
  importTasks?: ImportTaskPort["importTasks"];
  importTaskHistory?: ImportTaskPort["importTaskHistory"];
  subscribeImportTasks?: ImportTaskPort["subscribeImportTasks"];
  cancelImportTask?: ImportTaskPort["cancelImportTask"];
  retryImportTask?: ImportTaskPort["retryImportTask"];

  unfollowAccount(followId: string): Promise<void>;
  accountFollows(): Promise<readonly AccountFollow[]>;
  scheduleHistory(followId: string, afterRevision?: number, throughRevision?: number): Promise<ScheduleHistoryPage>;
  clientVersion(): string;
  autoFetchSetup(): Promise<{ autoFetchCapabilities?: AutoFetchCapabilities; settings: { homeTimezone: string | null; confirmed: boolean }; creators: readonly CreatorRecord[] }>;
  confirmTimezone(timezone: string): Promise<void>;
  parseCreator(profileUrl: string): Promise<CreatorParseResult>;
  followCreator(input: FollowCreatorInput): Promise<CreatorRecord>;
  setCreatorEnabled(creatorId: string, enabled: boolean): Promise<CreatorRecord>;
  previewCreatorSettings(creatorId: string, input: CreatorSettingsInput): Promise<CreatorSchedulePreview>;
  updateCreatorSettings(creatorId: string, input: CreatorSettingsInput, previewToken: string): Promise<CreatorRecord>;
  deleteCreator(creatorId: string): Promise<void>;
  runScheduled(reason: SchedulerReconcileReason): Promise<SchedulerRunResult>;
  runCreatorNow(creator: CreatorRecord): Promise<SchedulerRunResult>;
  retryCreator(creator: CreatorRecord): Promise<SchedulerRunResult>;
  importCreatorBaseline(creator: CreatorRecord): Promise<BatchSaveResult>;
}

export interface AgentLensWorkbenchPort
  extends SessionWorkbenchPort,
    ActivityWorkbenchPort,
    SingleWorkbenchPort,
    BulkWorkbenchPort,
    AutoFetchWorkbenchPort {}
