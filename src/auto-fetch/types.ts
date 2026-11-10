import type { CreatorRecord } from "../api/AgentLensApiClient";

/** Shared scheduling facts; the actual destination remains an Obsidian Vault. */
export type ScheduledCreator = Pick<CreatorRecord, "creatorId" | "platform" | "profileUrl" | "displayName"
  | "saveFolderPath" | "autoFetchEnabled" | "frequency" | "timezone" | "preferredTimes">
  & Partial<Pick<CreatorRecord, "noteTemplateId" | "mediaPolicy">> & {
    targetId?: string | undefined;
    followId?: string | undefined;
    configRevision?: number | undefined;
    scheduleAnchorAt?: string | undefined;
    activationAt?: string | undefined;
    saveFolderId?: string | undefined;
  };

export type { OperationPlan } from "../api/scheduleHistory";
