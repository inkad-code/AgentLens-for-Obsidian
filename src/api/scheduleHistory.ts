export interface ScheduleRevision {
  revision: number;
  effectiveAt: string;
  anchorAt: string;
  frequencyEvery: number;
  frequencyUnit: "minute" | "hour" | "day" | "week";
  autoFetchEnabled: boolean;
  deleted: boolean;
  legacySnapshot: boolean;
}

export interface ScheduleHistoryPage {
  followId: string;
  throughRevision: number;
  revisions: readonly ScheduleRevision[];
  nextAfterRevision: number | null;
}

function invalid(): never { throw new Error("Schedule history is incomplete or invalid. Refresh before relying on this history."); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return invalid();
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !value.endsWith("Z") || !Number.isFinite(Date.parse(value))) return invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return invalid();
  return value;
}

export function validateHistoryRange(after: number, through?: number): void {
  if (!Number.isSafeInteger(after) || after < 0 || (after > 0 && through === undefined)) invalid();
  if (through !== undefined && (integer(through) < after)) invalid();
}

/** Every returned version must be contiguous within the original server boundary. */
export function validateScheduleHistory(value: unknown, followId: string, after: number, through?: number): ScheduleHistoryPage {
  const data = record(value);
  const boundary = integer(data.throughRevision);
  if (data.followId !== followId || (through !== undefined && boundary !== through) || boundary < after
      || !Array.isArray(data.revisions) || data.revisions.length > 100) return invalid();
  const revisions = data.revisions.map((value, index): ScheduleRevision => {
    const row = record(value);
    const revision = integer(row.revision);
    const unit = row.frequencyUnit;
    if (revision !== after + index + 1 || revision > boundary
        || (unit !== "minute" && unit !== "hour" && unit !== "day" && unit !== "week")) return invalid();
    return { revision, effectiveAt: instant(row.effectiveAt), anchorAt: instant(row.anchorAt),
      frequencyEvery: integer(row.frequencyEvery), frequencyUnit: unit,
      autoFetchEnabled: boolean(row.autoFetchEnabled), deleted: boolean(row.deleted), legacySnapshot: boolean(row.legacySnapshot) };
  });
  const last = revisions.at(-1)?.revision ?? after;
  const next = data.nextAfterRevision === null ? null : integer(data.nextAfterRevision);
  if (next === null ? last !== boundary : next !== last || next <= after || next >= boundary) return invalid();
  return { followId, throughRevision: boundary, revisions: Object.freeze(revisions), nextAfterRevision: next };
}
