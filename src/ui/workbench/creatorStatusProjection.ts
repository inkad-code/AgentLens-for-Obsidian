import type { CreatorRecord } from "../../api/AgentLensApiClient";
import type { AutoFetchActivity } from "../../workbench/AutoFetchActivity";

const states = {
  paused: { label: "Paused", kind: "paused" },
  fetching: { label: "Fetching Now", kind: "running" },
  importing: { label: "Importing Now", kind: "running" },
  failed: { label: "Failed", kind: "failed" },
  scheduled: { label: "Scheduled", kind: "scheduled" }
} as const;
export function creatorStatus(creator: CreatorRecord, activity?: AutoFetchActivity) {
  const result = (mainStatus: keyof typeof states, subStatus: string) => ({ mainStatus, subStatus, ...states[mainStatus] });
  if (!creator.autoFetchEnabled) return result("paused", "paused");
  if (activity?.parsing) return result("fetching", "parsing");
  if (activity?.importing) return result("importing", "importing");
  const facts = creator.localStatus;
  if (facts?.statusResetAt && !facts.statusResetSuperseded
      && (facts.lastFetchRunSequence ?? 0) <= (facts.statusResetSequence ?? 0)) return result("scheduled", "resumed");
  if (facts?.writeFailed) return result("failed", "write_failed");
  const state = facts?.runState ?? creator.runState ?? creator.schedulerState;
  if (state === "quota_blocked") return result("failed", "quota_blocked");
  if (state === "auth_required" || state === "auth_blocked") return result("failed", "auth_required");
  if (["failed", "error", "partial_failed", "baseline_failed", "coverage_incomplete", "destination_blocked"].includes(state))
    return result("failed", "source_failed");
  if (facts?.writeUnknown) return result("scheduled", "verifying_write");
  if (state === "requires_reconciliation") return result("scheduled", "verifying_source");
  if (facts?.receiptPending) return result("scheduled", "receipt_pending");
  if (state === "retry_pending") return result("scheduled", "retry_pending");
  if (facts?.saveQueued) return result("scheduled", "save_queued");
  if (facts?.checkQueued || !facts && (creator.activeJobId || state === "due" || state === "catch_up_running")) return result("scheduled", "check_queued");
  return result("scheduled", "idle");
}
