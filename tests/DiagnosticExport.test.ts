import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { DiagnosticLog } from "@/diagnostics/log";
import { buildDiagnosticPackage } from "@/diagnostics/export";
import { OperationStore, type SourceOperation } from "@/auto-fetch/operation-store";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
const scope = { userId: "owner", installationId: "vault", creatorId: "creator" };
const at = "2026-10-19T00:00:00Z";
const task = (id: string): SourceOperation => ({ operationId: id, admissionKey: id, configRevision: 1, trigger: "normal",
  status: "queued", queuedAt: at, version: 0, attempts: 0, coverage: [], cursor: "PRIVATE_CURSOR",
  snapshot: { creatorId: "creator", platform: "youtube", profileUrl: "https://example.com/PRIVATE_PROFILE", displayName: "PRIVATE_NAME",
    saveFolderPath: "/Users/private/vault", autoFetchEnabled: true, frequency: { every: 1, unit: "hour" }, timezone: "UTC", preferredTimes: [] } });

it("exports bounded scoped observations, future callbacks and original task facts without private payloads", async () => {
  const operations = new OperationStore("export");
  await operations.admit(scope, undefined, { configRevision: 1, observedThrough: at }, Array.from({ length: 7 }, (_, i) => task(`run-${i}`)));
  await operations.admit({ ...scope, userId: "other" }, undefined, { configRevision: 1, observedThrough: at }, [task("FOREIGN_TASK")]);
  const callback = await operations.queueCallback(scope, "receipt", { creatorId: "creator", fetchId: "fetch", fetchRunId: "run-0", runId: "run-0",
    writeAttemptId: "attempt", results: [{ contentKey: "youtube:post", notePath: "/Users/private/note.md", status: "success" }] });
  await operations.updateCallback(callback, { status: "pending", attempts: 3, readyAt: Date.parse(at) + 60000 });
  const log = new DiagnosticLog("export-log", () => Date.parse(at));
  log.record("source.started", scope, { operationId: "run-0", accessToken: "SECRET_TOKEN" });
  log.record("source.started", { ...scope, userId: "other" }, { operationId: "FOREIGN_TASK" });
  const output = await buildDiagnosticPackage({ operations, log, scope, assertCurrent: async () => {}, now: () => Date.parse(at) });
  expect(output.collection).toMatchObject({ atomicSnapshot: false, completeness: "best_effort", maxOperationsPerStatusPerCreator: 5 });
  expect(output.queues.find(row => row.status === "queued")).toMatchObject({ truncated: true, items: Array.from({ length: 5 }, (_, i) => ({ operationId: `run-${i}` })) });
  expect(output.callbacks.find(row => row.status === "pending")).toMatchObject({ items: [{ operationId: "run-0", attempts: 3, nextAttemptAt: "2026-10-19T00:01:00.000Z" }] });
  expect(output.events).toHaveLength(1);
  expect(JSON.stringify(output)).not.toMatch(/PRIVATE|SECRET|FOREIGN|Users|note.md|profileUrl|accessToken/);
  expect((await operations.list(scope, "queued", 100)).operations).toHaveLength(7);
  expect(await operations.callback(scope, "receipt")).toMatchObject({ attempts: 3, status: "pending" });
});

it("marks unavailable sources explicitly rather than presenting an empty complete snapshot", async () => {
  const operations = new OperationStore("failure");
  vi.spyOn(operations, "scopes").mockRejectedValue(new Error("PRIVATE disk path"));
  vi.spyOn(operations, "callbackDiagnostics").mockRejectedValue(new Error("PRIVATE callback"));
  const output = await buildDiagnosticPackage({ operations, scope, assertCurrent: async () => {} });
  expect(output.collection.warnings).toEqual(["diagnostic_storage_unavailable", "operation_scopes_unavailable", "callback_snapshot_unavailable"]);
  expect(JSON.stringify(output)).not.toContain("PRIVATE");
});

it("aborts a delayed export after account changes even when an underlying read also fails", async () => {
  const operations = new OperationStore("changed");
  let current = true;
  vi.spyOn(operations, "scopes").mockImplementation(async () => { current = false; throw new Error("read failed"); });
  await expect(buildDiagnosticPackage({ operations, scope, assertCurrent: async () => {
    if (!current) throw new Error("Account changed");
  } })).rejects.toThrow("Account changed");
});
