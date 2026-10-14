import type { MediaPolicy, NormalizedPost } from "../core/domain";
import type { NoteWriteManifest, VaultWriteResult } from "../vault/VaultWriter";
import type { CreatorParseResult, FrequencyUnit } from "../api/AgentLensApiClient";

export type NoteTemplateId = "default" | "compact";

export interface PreviewResult {
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
  failures: Array<{ preview: PreviewResult; error: string }>;
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
