import type { ScheduleRevision } from "../api/scheduleHistory";
import type { ScheduledCreator as CreatorSubscription } from "./types";
import { OperationStore, type OperationScope, type SourceOperation } from "./operation-store";
import { compareUtcTime, latestResumeAt, slotTime, uncoveredSlots, utcMicrosKey, type SlotRange } from "./schedule-slots";

export interface AdmissionRequest {
  scope: OperationScope;
  binding: CreatorSubscription;
  history: ScheduleRevision[];
  now: string;
  /** Explicit verified migration/activation boundary; never derived from Next Check. */
  initialThrough: string;
  mode: "normal" | "recovery";
  /** Claims adopted from existing tasks during migration or reconciliation. */
  alreadyCovered?: SlotRange[];
}

export async function plannedOperationId(creatorId: string, trigger: "normal" | "catch_up", admissionKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${creatorId}\n${trigger}\n${admissionKey}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const encoded = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `af-${trigger}-${encoded}`;
}

/** Plans a bounded batch, then atomically commits its tasks and waterline. */
export async function admitOperations(store: OperationStore, request: AdmissionRequest): Promise<{
  committed: boolean; operationIds: string[]; more: boolean;
}> {
  const { scope, binding, history, now } = request;
  const current = history.at(-1);
  if (!current || current.revision !== binding.configRevision || binding.creatorId !== scope.creatorId)
    throw new Error("Synchronize the complete current configuration before admitting work.");
  if (!binding.autoFetchEnabled || !current.autoFetchEnabled || current.deleted)
    return { committed: false, operationIds: [], more: false };
  const previous = await store.watermark(scope);
  if (previous?.recoveryFrom && request.mode !== "recovery")
    throw new Error("Reconcile pending recovery before advancing normal admission.");
  const boundary = previous?.recoveryFrom ?? previous?.observedThrough ?? request.initialThrough;
  // Resume explicitly waives all unadmitted earlier slots, but never removes tasks.
  const resumedAt = latestResumeAt(history);
  const from = resumedAt && compareUtcTime(resumedAt, boundary) > 0 ? resumedAt : boundary;
  const ranges = uncoveredSlots(history, from, now, request.alreadyCovered ?? []);
  const operations: SourceOperation[] = [];
  const create = async (admissionKey: string, trigger: "normal" | "catch_up", coverage: SlotRange[], config: ScheduleRevision, scheduledAt?: string) => {
    // Admission identity is deterministic; transport attempts remain separately persisted.
    const operationId = await plannedOperationId(scope.creatorId, trigger, admissionKey);
    operations.push({ operationId, admissionKey, trigger, coverage, configRevision: config.revision,
      plan: trigger === "normal" ? { configRevision: config.revision, slotIndex: coverage[0]!.firstSlot }
        : { configRevision: config.revision, recoveryFrom: from, recoveryThrough: now },
      snapshot: { ...binding, configRevision: config.revision,
        frequency: { every: config.frequencyEvery, unit: config.frequencyUnit }, scheduleAnchorAt: config.anchorAt },
      ...(scheduledAt ? { scheduledAt } : {}), queuedAt: new Date(now).toISOString(), status: "queued", attempts: 0, version: 0 });
  };
  let observedThrough = now, more = false;
  if (request.mode === "recovery") {
    if (ranges.length) {
      const key = `recovery:${current.revision}:${utcMicrosKey(from)}:${utcMicrosKey(now)}`;
      await create(key, "catch_up", ranges, current);
    }
  } else {
    outer: for (const range of ranges) {
      const config = history.find(item => item.revision === range.revision)!;
      for (let slot = range.firstSlot; slot <= range.lastSlot; slot++) {
        if (operations.length === 100) { more = true; break outer; }
        const scheduledAt = slotTime(config, slot);
        await create(`slot:${config.revision}:${slot}`, "normal", [{ ...range, firstSlot: slot, lastSlot: slot }], config, scheduledAt);
        observedThrough = scheduledAt;
      }
    }
    if (!more) observedThrough = now;
  }
  const committed = await store.admit(scope, previous?.version, {
    observedThrough, configRevision: current.revision
  }, operations);
  return { committed, operationIds: committed ? operations.map(item => item.operationId) : [], more };
}
