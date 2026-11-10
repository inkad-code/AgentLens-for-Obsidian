import { AgentLensError } from "./errors";
export type MediaFailureKind = "source_expired" | "retryable" | "write_unknown";
export interface MediaFailureEvidence { mediaId: string; kind: MediaFailureKind; deferred?: boolean }

// Signed terminal addresses are transient transport facts, never enumerable error/queue fields.
const failedTargets = new WeakMap<MediaDownloadError, string>();

/** Download response facts are distinct from display text and local filesystem errors. */
export class MediaDownloadError extends Error {
  constructor(readonly kind: MediaFailureKind, message: string, readonly status?: number, readonly deferred = false) {
    super(message);
    this.name = "MediaDownloadError";
  }
  static http(status: number, target?: string): MediaDownloadError {
    const error = new MediaDownloadError([401, 403, 404, 410].includes(status) ? "source_expired" : "retryable",
      `Media download failed with HTTP ${status}.`, status);
    if (target) failedTargets.set(error, target);
    return error;
  }
  recoveryTarget(): string | undefined { return failedTargets.get(this); }
}

/** A failed 403 recovery must not trigger the workbench's legacy mobile URL refresh. */
export class MediaRecoveryError extends MediaDownloadError {
  constructor(cause: unknown) {
    super(cause instanceof MediaDownloadError ? cause.kind : "retryable",
      "Media download recovery failed. Retry the failed attachment.",
      cause instanceof MediaDownloadError ? cause.status : undefined);
    this.name = "MediaRecoveryError";
    this.cause = cause;
  }
}

/** A storage call may have published bytes before its promise rejected. */
export class MediaWriteUncertainError extends AgentLensError {
  constructor(readonly mediaId: string, cause: unknown) {
    super("vault_write_failed", "Saved files need verification before retrying.", false,
      undefined, { cause }, undefined, undefined, "WRITE_REQUIRES_RECONCILIATION");
  }
}

/** A note mutation may be durable even when the host fails to acknowledge it. */
export class NoteWriteUncertainError extends AgentLensError {
  constructor(cause: unknown) {
    super("vault_write_failed", "Saved files need verification before retrying.", false,
      undefined, { cause }, undefined, undefined, "WRITE_REQUIRES_RECONCILIATION");
  }
}
