import type { CreatorRecord } from "../api/AgentLensApiClient";
import type { OperationScope, OperationStore } from "./operation-store";
import { compareUtcTime } from "./schedule-slots";

/** Unreleased Obsidian bindings start once at cutover; restarts must never waive later gaps. */
export async function registerDevelopmentCreator(store: OperationStore, scope: OperationScope,
  creator: CreatorRecord, cutoverAt: string, sequenceFloor = 0): Promise<boolean> {
  if (scope.creatorId !== creator.creatorId || !creator.followId || !creator.configRevision) return false;
  compareUtcTime(cutoverAt, cutoverAt);
  // A binding activated after this pass began cannot acquire a pre-activation boundary.
  const observedThrough = creator.activationAt && compareUtcTime(creator.activationAt, cutoverAt) > 0
    ? creator.activationAt : cutoverAt;
  return store.admit(scope, undefined, { observedThrough, configRevision: creator.configRevision, lastSequence: sequenceFloor }, []);
}

/** Only a proven new binding may initialize at activation. Never reset an existing watermark. */
export async function registerNewCreator(store: OperationStore, scope: OperationScope,
  creator: CreatorRecord, requestStartedAt: string): Promise<boolean> {
  if (scope.creatorId !== creator.creatorId || !creator.followId || !creator.activationAt
      || !creator.configRevision || creator.lastCheckedAt || creator.activeJobId) return false;
  if (compareUtcTime(creator.activationAt, requestStartedAt) < 0) return false;
  return store.admit(scope, undefined, { observedThrough: creator.activationAt,
    configRevision: creator.configRevision }, []);
}
