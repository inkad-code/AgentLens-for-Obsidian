import { describe, expect, it, vi } from "vitest";
import { SchedulerCoordinator } from "@/workbench/SchedulerCoordinator";
import { DurableActionStore } from "@/workbench/DurableActionStore";
import { PluginStateStore } from "@/runtime/PluginStateStore";
import { RequestCoordinator } from "@/runtime/RequestCoordinator";
import { AuthService } from "@/auth/AuthService";
import type { AgentLensApiPort } from "@/workbench/ports";
import type { CreatorRecord, CreatorUpdatePage, SchedulerLease } from "@/api/AgentLensApiClient";
import type { AccountCapabilities } from "@/api/contracts";
import { AgentLensError } from "@/core/errors";

const lease: SchedulerLease = { creatorId: "creator", leaseId: "run", trigger: "normal", saveFolderPath: "Original",
  noteTemplateId: "default", mediaPolicy: "link_only", schedulerState: "due", nextCheckAt: null };
function page(index: number, total: number): CreatorUpdatePage {
  return { creatorId: "creator", leaseId: "run", fetchRunId: "run", fetchId: `fetch-${index}`, previews: [],
    cursor: index < total ? `cursor-${index + 1}` : null, hasMore: index < total,
    coverageComplete: index === total, truncated: false, stopReason: index === total ? "no_next_page" : null, requestId: `request-${index}` };
}
function fixture(total = 105) {
  let data: unknown = { agentlensState: { installationId: "installation" } };
  let sequence = 0;
  let accountId = "account";
  let failDisk = false;
  let refreshToken: string | null = "refresh";
  const adapter = { async loadData() { return structuredClone(data); },
    async saveData(value: unknown) { if (failDisk) throw new Error("disk unavailable"); data = structuredClone(value); } };
  const state = new PluginStateStore(adapter, () => "installation");
  const store = new DurableActionStore(state, () => `id-${++sequence}`);
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn(),
    refresh: async () => ({ accessToken: "token", expiresIn: 3600 }) },
  { async load() { return refreshToken; }, async save(value) { refreshToken = value; }, async clear() { refreshToken = null; } });
  const reconcile = vi.fn().mockResolvedValue({ serverTime: "now", leases: [] });
  reconcile.mockResolvedValueOnce({ serverTime: "now", leases: [lease] });
  const creatorUpdates = vi.fn(async (_token: string, currentLease: SchedulerLease, cursor: string | null) => ({
    ...page(cursor ? Number(cursor.split("-")[1]) : 1, total), fetchRunId: currentLease.leaseId, leaseId: currentLease.leaseId
  }));
  const manualCreatorUpdates = vi.fn(async () => page(1, total));
  const getExecution = vi.fn(async (_token?: string, operationId = "run") => ({ operationId, creatorId: "creator", runTrigger: "normal", sourceStatus: "source_succeeded",
    retryAt: null as string | null, latestPageNumber: total, nextPageCursor: null, activePageCursor: null,
    target: { installationId: "installation", bindingId: "creator", targetId: null, folderId: null, folderPath: "Original" } }));
  const inspectExecutionRecovery = vi.fn(async () => ({ operationId: "run", creatorId: "creator", configRevision: 7, disposition: "unresolved" }));
  const resumeUnstartedExecution = vi.fn(async () => ({ operationId: "run", creatorId: "creator", configRevision: 7, disposition: "not_started" }));
  const api = { reconcile, creatorUpdates, manualCreatorUpdates, getExecution, inspectExecutionRecovery, resumeUnstartedExecution } as unknown as AgentLensApiPort;
  const operations = { requireSupportedVersion: async () => ({ accountId } as AccountCapabilities),
    flushPendingWrites: vi.fn(async () => 0), flushPendingCallbacks: vi.fn(async () => 0),
    saveMany: vi.fn(), planPreview: vi.fn(), writeLocal: vi.fn(), recordCreatorSavedPage: vi.fn() };
  function restart() {
    const reopened = new PluginStateStore(adapter, () => "must-not-regenerate");
    return new SchedulerCoordinator(auth, api, new DurableActionStore(reopened, () => `id-${++sequence}`),
      new RequestCoordinator(), () => `id-${++sequence}`, operations);
  }
  return { restart, state, store, creatorUpdates, manualCreatorUpdates, reconcile, auth, operations,
    getExecution, inspectExecutionRecovery, resumeUnstartedExecution,
    switchAccount(value: string) { accountId = value; }, failDisk(value: boolean) { failDisk = value; } };
}

describe("Durable scheduler pagination", () => {
  it("keeps the legacy manual request identity when recovering an existing first-page checkpoint", async () => {
    const f = fixture(1);
    f.reconcile.mockReset().mockResolvedValue({ serverTime: "now", leases: [] });
    const old = await f.store.prepareSchedulerCheckpoint("account", { ...lease, trigger: "manual_check", leaseId: "old-local-id" }, null, 1, true);
    await f.restart().runScheduled("service_start");
    expect(f.manualCreatorUpdates).toHaveBeenCalledWith("token", "creator", old.requestId, old.idempotencyKey);
    expect(f.creatorUpdates).not.toHaveBeenCalled();
    expect(await f.store.schedulerCheckpoints("account")).toEqual([]);
  });

  it.each(["running", "requires_reconciliation", "unknown_state"])("retains uncertain %s without redispatch", async (sourceStatus) => {
    const f = fixture(2);
    const remote = await f.getExecution();
    f.getExecution.mockClear().mockResolvedValue({ ...remote, latestPageNumber: 0, sourceStatus });
    f.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow("response lost");
    expect((await f.store.schedulerCheckpoints("account"))[0]?.attempted).toBe(true);
    expect(await f.restart().runScheduled("service_start")).toMatchObject({ deferred: 1, pages: 0 });
    expect(f.getExecution).toHaveBeenCalledWith("token", "run");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(await f.store.schedulerCheckpoints("account")).toHaveLength(1);
  });

  it.each(["failed", "coverage_incomplete"])("retains %s evidence without rescheduling a terminal checkpoint", async (sourceStatus) => {
    const f = fixture(1);
    const remote = await f.getExecution();
    f.getExecution.mockResolvedValue({ ...remote, latestPageNumber: 0, sourceStatus });
    f.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow();
    const original = (await f.store.schedulerCheckpoints("account"))[0]!;
    expect(await f.restart().runScheduled("periodic_tick")).toMatchObject({ terminated: 1, pages: 0 });
    expect(await f.store.schedulerCheckpoints("account")).toEqual([]);
    expect((await f.store.schedulerCheckpoints("account", true))[0]).toMatchObject({
      pageNumber: 1, requestId: original.requestId, idempotencyKey: original.idempotencyKey, terminal: { status: sourceStatus }
    });
    // A stale lease cannot resurrect the same operation or erase its evidence.
    f.reconcile.mockResolvedValueOnce({ serverTime: "now", leases: [lease] });
    await f.restart().runScheduled("service_start");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(await f.store.schedulerCheckpoints("account", true)).toHaveLength(1);
  });

  it("allows a new manual check after a confirmed terminal manual run, retaining the old evidence", async () => {
    const f = fixture(1);
    f.reconcile.mockReset().mockResolvedValue({ serverTime: "now", leases: [] });
    const current = await f.store.prepareSchedulerCheckpoint("account", { ...lease, trigger: "manual_check" });
    await f.store.markSchedulerTerminal(current, "failed");
    await f.restart().runCreatorNow({ ...lease, displayName: "Creator", autoFetchEnabled: false } as unknown as CreatorRecord);
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(f.manualCreatorUpdates).not.toHaveBeenCalled();
    expect(await f.store.schedulerCheckpoints("account")).toEqual([]);
    expect((await f.store.schedulerCheckpoints("account", true))[0]?.terminal?.status).toBe("failed");
  });

  it("honors retryAt before replaying the same page", async () => {
    const f = fixture(1);
    const remote = await f.getExecution();
    f.getExecution.mockResolvedValue({ ...remote, latestPageNumber: 0, sourceStatus: "retry_pending", retryAt: "2999-01-01T00:00:00Z" });
    f.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow();
    await f.restart().runScheduled("periodic_tick");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    f.getExecution.mockResolvedValue({ ...remote, latestPageNumber: 0, sourceStatus: "retry_pending", retryAt: "2000-01-01T00:00:00Z" });
    await f.restart().runScheduled("periodic_tick");
    expect(f.creatorUpdates.mock.calls[1]).toEqual(f.creatorUpdates.mock.calls[0]);
  });

  it("requires positive unstarted evidence and the same revision after a missing operation", async () => {
    const f = fixture(1);
    f.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    f.getExecution.mockRejectedValue(new AgentLensError("unknown", "not found", false, 404));
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow();
    await f.restart().runScheduled("periodic_tick");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(f.resumeUnstartedExecution).not.toHaveBeenCalled();
    f.inspectExecutionRecovery.mockResolvedValue({ operationId: "run", creatorId: "creator", configRevision: 7, disposition: "not_started" });
    await f.restart().runScheduled("periodic_tick");
    expect(f.resumeUnstartedExecution).toHaveBeenCalledWith("token", "creator", "run", 7);
    expect(f.creatorUpdates.mock.calls[1]).toEqual(f.creatorUpdates.mock.calls[0]);
  });

  it("rejects a changed remote destination before replay or local writing", async () => {
    const f = fixture(1);
    const remote = await f.getExecution();
    f.getExecution.mockResolvedValue({ ...remote, target: { ...remote.target, folderPath: "Different" } });
    f.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow();
    await expect(f.restart().runScheduled("periodic_tick")).rejects.toThrow("target changed");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(1);
    expect(f.operations.writeLocal).not.toHaveBeenCalled();
  });

  it("queries the original manual operation after a lost first response and preserves its target", async () => {
    const f = fixture(11);
    f.reconcile.mockReset().mockResolvedValue({ serverTime: "now", leases: [] });
    const creator = { ...lease, displayName: "Creator", autoFetchEnabled: false } as unknown as CreatorRecord;
    f.creatorUpdates.mockRejectedValueOnce(new Error("manual response lost"));
    await expect(f.restart().runCreatorNow(creator)).rejects.toThrow("manual response lost");
    const original = (await f.store.schedulerCheckpoints("account"))[0]!;
    expect(original).toMatchObject({ attempted: true, pageNumber: 1 });
    expect(original.manualStart).not.toBe(true);
    await f.restart().runScheduled("service_start");
    expect(f.getExecution).toHaveBeenCalledWith("token", original.lease.leaseId);
    expect(f.creatorUpdates.mock.calls[1]).toEqual(f.creatorUpdates.mock.calls[0]);
    expect((await f.store.schedulerCheckpoints("account"))[0]).toMatchObject({ pageNumber: 11, manualStart: false,
      lease: { leaseId: original.lease.leaseId, saveFolderPath: "Original", trigger: "manual_check" } });
    // A new click while the old manual run still has pages continues that run.
    await f.restart().runCreatorNow({ ...creator, saveFolderPath: "Changed" });
    expect(f.manualCreatorUpdates).not.toHaveBeenCalled();
    expect(f.creatorUpdates.mock.calls.every((call) => call[1].saveFolderPath === "Original")).toBe(true);
    expect(await f.store.schedulerCheckpoints("account")).toEqual([]);
  });

  it("continues beyond 100 pages across process instances in bounded batches, preserving the original target", async () => {
    const f = fixture();
    for (let batch = 0; batch < 11; batch++) {
      const result = await f.restart().runScheduled("service_start");
      expect(result.pages).toBe(batch === 10 ? 5 : 10);
      const pending = await f.store.schedulerCheckpoints("account");
      if (batch < 10) expect(pending[0]).toMatchObject({ pageNumber: (batch + 1) * 10 + 1, cursor: `cursor-${(batch + 1) * 10 + 1}`, lease });
      else expect(pending).toEqual([]);
      if (batch === 0) f.reconcile.mockResolvedValueOnce({ serverTime: "now", leases: [{ ...lease, saveFolderPath: "Changed" }] });
    }
    expect(f.creatorUpdates).toHaveBeenCalledTimes(105);
    expect(f.creatorUpdates.mock.calls.every((call) => call[1].saveFolderPath === "Original")).toBe(true);
    await f.restart().runScheduled("periodic_tick");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(105);
  });

  it("replays exactly the same page identity after a lost response and restart", async () => {
    const f = fixture(2);
    f.creatorUpdates.mockRejectedValueOnce(new Error("response lost"));
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow("response lost");
    const before = (await f.store.schedulerCheckpoints("account"))[0];
    await f.restart().runScheduled("network_restored");
    expect(f.creatorUpdates.mock.calls[1]).toEqual(f.creatorUpdates.mock.calls[0]);
    expect(before).toMatchObject({ pageNumber: 1, cursor: null, idempotencyKey: "auto-run-1" });
    expect(await f.store.schedulerCheckpoints("account")).toEqual([]);
  });

  it("retains another account's continuation without sending it", async () => {
    const f = fixture(11);
    await f.restart().runScheduled("service_start");
    f.switchAccount("different");
    await f.restart().runScheduled("periodic_tick");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(10);
    expect(await f.store.schedulerCheckpoints("account")).toHaveLength(1);
    f.switchAccount("account");
    await f.restart().runScheduled("periodic_tick");
    expect(f.creatorUpdates).toHaveBeenCalledTimes(11);
  });

  it("keeps evidence and reports incomplete coverage when a continuation cursor is missing", async () => {
    const f = fixture();
    f.creatorUpdates.mockResolvedValueOnce({ ...page(1, 2), cursor: null });
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow("next cursor");
    expect((await f.store.schedulerCheckpoints("account"))[0]?.pageNumber).toBe(1);
  });

  it("does not treat a truncated terminal page as completion", async () => {
    const f = fixture(1);
    f.creatorUpdates.mockResolvedValueOnce({ ...page(1, 1), truncated: true, coverageComplete: false });
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow("coverage is incomplete");
    expect(await f.store.schedulerCheckpoints("account")).toHaveLength(1);
  });

  it("does not consume a response belonging to another operation", async () => {
    const f = fixture(1);
    f.creatorUpdates.mockResolvedValueOnce({ ...page(1, 1), fetchRunId: "other-run" });
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow("identity changed");
    expect(await f.store.schedulerCheckpoints("account")).toHaveLength(1);
  });

  it("retains the current request when advancing the cursor cannot be persisted", async () => {
    const f = fixture(2);
    f.creatorUpdates.mockImplementationOnce(async () => { f.failDisk(true); return page(1, 2); });
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow("disk unavailable");
    f.failDisk(false);
    expect((await f.store.schedulerCheckpoints("account"))[0]?.pageNumber).toBe(1);
    await f.restart().runScheduled("service_start");
    expect(f.creatorUpdates.mock.calls[1]).toEqual(f.creatorUpdates.mock.calls[0]);
  });

  it("defers an in-flight page when the user signs out before its response", async () => {
    const f = fixture(1);
    f.creatorUpdates.mockImplementationOnce(async () => { await f.auth.signOut(); return page(1, 1); });
    await expect(f.restart().runScheduled("service_start")).rejects.toThrow("session changed");
    expect(await f.store.schedulerCheckpoints("account")).toHaveLength(1);
    expect(f.operations.writeLocal).not.toHaveBeenCalled();
  });
});
