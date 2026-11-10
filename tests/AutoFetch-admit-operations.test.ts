import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { ScheduleRevision } from "@/api/scheduleHistory";
import { OperationStore } from "@/auto-fetch/operation-store";
import { admitOperations, plannedOperationId, type AdmissionRequest } from "@/auto-fetch/admit-operations";

const revision: ScheduleRevision = { revision: 1, effectiveAt: "2026-09-16T08:00:00Z", anchorAt: "2026-09-16T08:00:00Z",
  frequencyEvery: 1, frequencyUnit: "hour", autoFetchEnabled: true, deleted: false, legacySnapshot: false };
const request: AdmissionRequest = {
  scope: { userId: "owner", installationId: "installation", creatorId: "creator" },
  binding: { creatorId: "creator", configRevision: 1, platform: "instagram", profileUrl: "https://instagram.com/test/", displayName: "Test",
    saveFolderId: "folder", saveFolderPath: "/Folder", autoFetchEnabled: true,
    frequency: { every: 1, unit: "hour" }, timezone: "UTC", preferredTimes: [] },
  history: [revision], now: "2026-09-16T13:00:00Z", initialThrough: revision.effectiveAt, mode: "normal"
};
describe("schedule-to-durable-operation admission", () => {
  it("uses the backend's canonical identity and fits existing receipt ID columns", async () => {
    expect(await plannedOperationId("creator", "normal", "slot:3:2"))
      .toBe("af-normal-bp3-Tx50me8QdTHIjEA7oFQH4sNpg4q9gUa4m3cJPUU");
    expect((await plannedOperationId("creator", "catch_up", "recovery:999999:1:9999999999999999")).length).toBeLessThanOrEqual(64);
  });
  it("adopts every due slot and repeated timer calls cannot duplicate them", async () => {
    const store = new OperationStore("admit");
    const first = await admitOperations(store, request);
    expect(first.operationIds).toHaveLength(5);
    expect((await admitOperations(new OperationStore("admit"), request)).operationIds).toEqual([]);
    expect((await store.list(request.scope, "queued")).operations.map(item => item.scheduledAt)).toEqual([
      "2026-09-16T09:00:00.000Z", "2026-09-16T10:00:00.000Z", "2026-09-16T11:00:00.000Z",
      "2026-09-16T12:00:00.000Z", "2026-09-16T13:00:00.000Z"
    ]);
  });
  it("one recovery task covers only post-resume gaps after excluding existing tasks", async () => {
    const store = new OperationStore("recovery");
    const recovery: AdmissionRequest = { ...request, mode: "recovery", now: "2026-09-16T16:00:00Z",
      binding: { ...request.binding, configRevision: 3 }, history: [revision,
        { ...revision, revision: 2, autoFetchEnabled: false, effectiveAt: "2026-09-16T10:00:00Z" },
        { ...revision, revision: 3, effectiveAt: "2026-09-16T13:00:00Z" }],
      alreadyCovered: [{ revision: 3, firstSlot: 6, lastSlot: 6 }] };
    const result = await admitOperations(store, recovery);
    expect(result.operationIds).toHaveLength(1);
    const task = await store.get(request.scope, result.operationIds[0]!);
    expect(task?.trigger).toBe("catch_up");
    expect(task?.coverage).toEqual([{ revision: 3, firstSlot: 7, lastSlot: 8 }]);
    expect((await admitOperations(store, recovery)).operationIds).toEqual([]);
  });
  it("bounds normal admission and resumes the remainder from the committed waterline", async () => {
    const store = new OperationStore("batch");
    const many: AdmissionRequest = { ...request, now: "2026-09-16T10:30:00Z",
      binding: { ...request.binding, frequency: { every: 1, unit: "minute" } },
      history: [{ ...revision, frequencyUnit: "minute" }] };
    const first = await admitOperations(store, many);
    expect(first.operationIds).toHaveLength(100); expect(first.more).toBe(true);
    expect((await store.watermark(request.scope))?.observedThrough).toBe("2026-09-16T09:40:00.000Z");
    const second = await admitOperations(new OperationStore("batch"), many);
    expect(second.operationIds).toHaveLength(50); expect(second.more).toBe(false);
    expect(new Set([...first.operationIds, ...second.operationIds]).size).toBe(150);
  });
  it("different creators cannot share backend operation identities", async () => {
    const store = new OperationStore("identities");
    const first = await admitOperations(store, request);
    const second = await admitOperations(store, { ...request,
      scope: { ...request.scope, creatorId: "other" }, binding: { ...request.binding, creatorId: "other" } });
    expect(first.operationIds.some(id => second.operationIds.includes(id))).toBe(false);
  });
  it("paused configuration cannot admit automatic work or erase earlier recovery demand", async () => {
    const store = new OperationStore("pause");
    await store.admit(request.scope, undefined, { configRevision: 1, observedThrough: revision.effectiveAt, recoveryFrom: revision.effectiveAt }, []);
    const before = await store.watermark(request.scope);
    expect((await admitOperations(store, { ...request, mode: "recovery", binding: { ...request.binding, autoFetchEnabled: false } })).operationIds).toEqual([]);
    expect(await store.watermark(request.scope)).toEqual(before);
  });
  it("missing configuration history does not advance the waterline", async () => {
    const store = new OperationStore("missing");
    await expect(admitOperations(store, { ...request, initialThrough: "2026-09-15T08:00:00Z" })).rejects.toThrow("does not cover");
    expect(await store.watermark(request.scope)).toBeUndefined();
    expect((await store.list(request.scope, "queued")).operations).toEqual([]);
  });
});
