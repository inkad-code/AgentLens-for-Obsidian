export interface FollowChangePage {
  throughEventId: number;
  nextAfterEventId: number;
  hasMore: boolean;
  changes: readonly { eventId: number; followId: string; configRevision: number; eventType: string }[];
}

export function validateFollowChanges(value: unknown, after: number, through?: number): FollowChangePage {
  const fail = (): never => { throw new Error("Invalid configuration sync page; retain the previous cursor."); };
  const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!integer(after) || (through !== undefined && (!integer(through) || through < after))) return fail();
  if (!value || typeof value !== "object") return fail();
  const page = value as Record<string, unknown>;
  if (!integer(page.throughEventId) || page.throughEventId < after
      || (through !== undefined && page.throughEventId !== through)
      || !integer(page.nextAfterEventId) || typeof page.hasMore !== "boolean"
      || !Array.isArray(page.changes) || page.changes.length > 100) return fail();
  let previous = after;
  for (const item of page.changes as unknown[]) {
    if (!item || typeof item !== "object") return fail();
    const change = item as Record<string, unknown>;
    if (!change || !integer(change.eventId) || change.eventId <= previous || change.eventId > page.throughEventId
        || typeof change.followId !== "string" || !change.followId.trim()
        || !integer(change.configRevision) || change.configRevision < 1
        || typeof change.eventType !== "string" || !["follow_config_changed", "follow_deleted"].includes(change.eventType)) return fail();
    previous = change.eventId;
  }
  if (page.hasMore ? previous <= after || page.nextAfterEventId !== previous || previous >= page.throughEventId
      : page.nextAfterEventId !== page.throughEventId) return fail();
  return page as unknown as FollowChangePage;
}
