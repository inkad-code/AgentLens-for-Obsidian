import type { OperationScope } from "../auto-fetch/operation-store";
import type { WriteResultsRequest } from "../api/AgentLensApiClient";
import type { MediaPolicy, NormalizedPost } from "../core/domain";
import type { NoteWriteManifest, VaultWriteResult } from "../vault/VaultWriter";
import type { CreatorParseResult, FrequencyUnit } from "../api/AgentLensApiClient";

export type NoteTemplateId = "default" | "compact";

export interface PreviewResult {
  historyRestore?: boolean;
  deferredMedia?: readonly import("../core/mediaFailure").MediaFailureEvidence[] | undefined;
  indexedWrite?: { scope: OperationScope; request: WriteResultsRequest; folderPath: string } | undefined;
  fetchRunId?: string | undefined;
  fetchRunSequence?: number | undefined;
  post: NormalizedPost;
  fetchId?: string | undefined;
  usageRemaining?: number | null | undefined;
  usage?: { charged: boolean; units: number; remaining: number | null } | undefined;
  monitoringInstanceId?: string | undefined;
  demo: boolean;
}

export interface SaveResult {
  write: VaultWriteResult;
  callback: "not_required" | "acknowledged" | "pending";
}

export interface BatchSaveResult {
  successes: SaveResult[];
  failures: Array<{ preview: PreviewResult; error: string; code?: string; mediaFailures?: readonly import("../core/mediaFailure").MediaFailureEvidence[] }>;
}

export interface PreparedSave {
  preview: PreviewResult;
  manifest: NoteWriteManifest;
}

export interface SchedulerRunResult {
  leases: number;
  pages: number;
  saved: number;
  failed: number;
  skipped: "signed_out" | null;
  deferred?: number;
  terminated?: number;
}

export interface WriteOptions {
  folderPath?: string | undefined;
  mediaPolicy?: MediaPolicy | undefined;
  templateId?: NoteTemplateId | undefined;
  saveAsCopy?: boolean | undefined;
  targetNotePath?: string | undefined;
}

export interface FollowCreatorInput {
  parsed: CreatorParseResult;
  saveFolderPath: string;
  timezone: string;
  every: number;
  unit: FrequencyUnit;
  preferredTimes?: readonly string[] | undefined;
  noteTemplateId: NoteTemplateId;
  mediaPolicy: MediaPolicy;
}

export interface SaveTransferProgress {
  contentKey: string;
  downloadedCount: number;
  downloading: boolean;
  attachmentIndex: number;
  attachmentCount: number;
  receivedBytes: number;
  totalBytes?: number | undefined;
}
export interface ManualSaveOptions {
  signal?: AbortSignal;
  onTransfer?: (progress: SaveTransferProgress) => void;
}
