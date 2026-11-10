import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperationStore } from "@/auto-fetch/operation-store";
import { SchedulerCoordinator } from "@/workbench/SchedulerCoordinator";
import { DurableActionStore } from "@/workbench/DurableActionStore";
import { PluginStateStore } from "@/runtime/PluginStateStore";
import { RequestCoordinator } from "@/runtime/RequestCoordinator";
import type { AuthService } from "@/auth/AuthService";
import type { AgentLensApiPort } from "@/workbench/ports";
import type { CreatorRecord, CreatorUpdatePage } from "@/api/AgentLensApiClient";
import type { NoteWriteManifest, VaultWriteResult } from "@/vault/VaultWriter";
import type { PreviewResult } from "@/workbench/types";
import type { AccountCapabilities } from "@/api/contracts";

beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });
it.each([1, 2])("keeps %i partial works out of legacy retry and reports each attempt independently", async count => {
  const now = new Date("2026-10-19T00:00:00Z"); vi.setSystemTime(now);
  const scope = { userId: "account", installationId: "installation", creatorId: "creator" };
  const creator = { creatorId: "creator", followId: "follow", configRevision: 1, activationAt: now.toISOString(),
    scheduleAnchorAt: now.toISOString(), saveFolderPath: "Research", noteTemplateId: "default", mediaPolicy: "download_all",
    autoFetchEnabled: false, frequency: { every: 1, unit: "hour" } } as CreatorRecord;
  let stateData: unknown = {};
  const state = new PluginStateStore({ async loadData() { return stateData; }, async saveData(value) { stateData = structuredClone(value); } }, () => "installation");
  let nextId = 0;
  const durable = new DurableActionStore(state, () => `id-${++nextId}`);
  const store = new OperationStore("delivery");
  await store.admit(scope, undefined, { configRevision: 1, observedThrough: now.toISOString() }, [{
    operationId: "run", admissionKey: "run", configRevision: 1, trigger: "normal", snapshot: creator,
    coverage: [], status: "queued", attempts: 0, version: 0, queuedAt: now.toISOString()
  }]);
  const post = { platform: "youtube", contentId: "post", canonicalUrl: "https://example.com/post", text: "post",
    author: { id: "author", displayName: "Author" }, media: [{ id: "media", kind: "image" as const,
      sourceUrl: "https://cdn.example.com/file?signature=fixture", downloadUrlExpiresAt: "2026-10-20T00:00:00Z" }] };
  const creatorUpdates = vi.fn(async (): Promise<CreatorUpdatePage> => ({ creatorId: "creator", fetchRunId: "run", leaseId: "run",
    fetchId: "fetch", requestId: "request", previews: Array.from({ length: count }, (_, index) => ({ ...post, contentId: index ? `post-${index}` : "post" })), cursor: null, hasMore: false, coverageComplete: true, truncated: false, stopReason: "done" }));
  const writeResults = vi.fn<AgentLensApiPort["writeResults"]>(async () => ({ accepted: 1, success: 0, partial: 1, failed: 0, skipped: 0 }));
  const api = { listCreators: async () => [creator], creatorUpdates, writeResults } as unknown as AgentLensApiPort;
  const manifest = { contentKey: "youtube:post", notePath: "Research/post.md", action: "new", attachments: [] } as unknown as NoteWriteManifest;
  const partial = { manifest, ledger: { contentKey: "youtube:post", notePath: "Research/post.md", completion: "partial" },
    attachments: [{ mediaId: "media", path: "Research/file.png", status: "failed", error: "temporary connection failure" }] } as unknown as VaultWriteResult;
  const writeLocal = vi.fn(async (preview: PreviewResult) => ({ ...partial,
    ledger: { ...partial.ledger, contentKey: `youtube:${preview.post.contentId}`, notePath: `Research/${preview.post.contentId}.md` } }));
  const flushPendingWrites = vi.fn(async () => 0);
  const scheduler = new SchedulerCoordinator({ accessToken: async () => "token" } as AuthService, api, durable,
    new RequestCoordinator(), () => `id-${++nextId}`, {
      requireSupportedVersion: async () => ({ accountId: "account" } as AccountCapabilities),
      flushPendingWrites, flushPendingCallbacks: async () => 0, saveMany: vi.fn(),
      planPreview: async () => manifest, writeLocal
    }, undefined, { store, session: async () => ({ ...scope, accessToken: "token", epoch: 1, sequenceFloor: 0 }) });
  expect(await scheduler.runScheduled("service_start")).toMatchObject({ failed: count });
  expect(writeLocal).toHaveBeenCalledWith(expect.objectContaining({ post }), manifest);
  expect(await durable.pendingWrites()).toEqual([]);
  expect(await durable.pendingCallbacks()).toEqual([]);
  expect(await store.callback(scope, writeResults.mock.calls[0]![2]!))
    .toMatchObject({ status: "acknowledged", request: { writeAttemptId: "run:fetch:1" } });
  expect(await store.pendingPages(scope)).toHaveLength(1);
  await scheduler.runScheduled("periodic_tick");
  expect(writeLocal).toHaveBeenCalledTimes(count);
  writeLocal.mockImplementation(async preview => ({ ...partial, ledger: { ...partial.ledger, completion: "complete",
    contentKey: `youtube:${preview.post.contentId}`, notePath: `Research/${preview.post.contentId}.md` },
    attachments: [{ mediaId: "media", path: "Research/file.png", status: "saved" }] }));
  vi.setSystemTime(new Date(now.getTime() + 300_000));
  await scheduler.runScheduled("periodic_tick");
  expect(creatorUpdates).toHaveBeenCalledTimes(1);
  expect(new Set(writeResults.mock.calls.map(call => call[2])).size).toBe(count * 2);
  for (const [, request] of writeResults.mock.calls) expect(request.runComplete).toBe(false);
  expect(await store.pendingPages(scope)).toEqual([]);
  expect(writeResults).toHaveBeenCalledWith("token", expect.objectContaining({ fetchRunId: "run", writeAttemptId: "run:fetch:1" }), expect.stringMatching(/^auto-results-[a-f0-9]{64}$/));
  expect(writeResults).toHaveBeenCalledWith("token", expect.objectContaining({ fetchRunId: "run", writeAttemptId: "run:fetch:2" }), expect.stringMatching(/^auto-results-[a-f0-9]{64}$/));
});
