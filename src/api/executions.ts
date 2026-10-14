/** Shared server evidence. Reading this contract never dispatches a fetch. */
export interface ExecutionOperation {
  operationId: string;
  creatorId: string;
  runTrigger: string;
  sourceStatus: string;
  retryAt: string | null;
  latestPageNumber: number;
  nextPageCursor: string | null;
  activePageCursor: string | null;
  target: { installationId: string; bindingId: string; targetId: string | null; folderId: string | null; folderPath: string | null };
}

export interface ExecutionRecovery {
  operationId: string;
  creatorId: string;
  configRevision: number;
  disposition: "not_started" | "operation_exists" | "blocked" | "unresolved";
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid execution evidence");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid execution ${field}`);
  return value;
}
function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Invalid execution ${field}`);
  return value;
}
export function executionInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid execution ${field}`);
  return value;
}

export function validateExecution(value: unknown, operationId: string, installationId: string): ExecutionOperation {
  const data = record(value);
  const target = record(data.target);
  if (text(data.operationId, "operationId") !== operationId || text(target.installationId, "installationId") !== installationId) {
    throw new Error("Execution evidence identity mismatch");
  }
  const creatorId = text(data.creatorId, "creatorId");
  if (text(target.bindingId, "bindingId") !== creatorId) throw new Error("Execution evidence binding mismatch");
  const retryAt = nullableText(data.retryAt, "retryAt");
  if (retryAt !== null && ((!retryAt.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(retryAt)) || !Number.isFinite(Date.parse(retryAt)))) {
    throw new Error("Invalid execution retryAt");
  }
  return {
    operationId, creatorId, runTrigger: text(data.runTrigger, "runTrigger"), sourceStatus: text(data.sourceStatus, "sourceStatus"),
    retryAt, latestPageNumber: executionInteger(data.latestPageNumber, "latestPageNumber"),
    nextPageCursor: nullableText(data.nextPageCursor, "nextPageCursor"), activePageCursor: nullableText(data.activePageCursor, "activePageCursor"),
    target: { installationId, bindingId: creatorId, targetId: nullableText(target.targetId, "targetId"),
      folderId: nullableText(target.folderId, "folderId"), folderPath: nullableText(target.folderPath, "folderPath") }
  };
}

export function validateRecovery(value: unknown, creatorId: string, operationId: string): ExecutionRecovery {
  const data = record(value);
  if (data.operationId !== operationId || data.creatorId !== creatorId) throw new Error("Recovery evidence identity mismatch");
  const disposition = data.disposition;
  if (disposition !== "not_started" && disposition !== "operation_exists" && disposition !== "blocked" && disposition !== "unresolved") {
    throw new Error("Invalid recovery disposition");
  }
  return { operationId, creatorId, disposition, configRevision: executionInteger(data.configRevision, "configRevision") };
}
