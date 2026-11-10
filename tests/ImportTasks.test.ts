import { describe, expect, it, vi } from "vitest";
import { ImportTasks, importStatus } from "@/workbench/ImportTasks";
import { PluginStateStore } from "@/runtime/PluginStateStore";
import type { SchedulerCheckpoint } from "@/workbench/DurableActionStore";
import type { NoteWriteManifest, VaultWriteResult } from "@/vault/VaultWriter";
import type { CreatorRecord, CreatorUpdatePage } from "@/api/AgentLensApiClient";
import type { ImportTask } from "@/workbench/ImportTasks";

export const checkpoint: SchedulerCheckpoint = { id: "task-1", accountId: "a", installationId: "i", attempted: false,
  lease: { creatorId: "creator", leaseId: "run", trigger: "normal", saveFolderPath: "Inbox", noteTemplateId: "default", mediaPolicy: "download_all", schedulerState: "due", nextCheckAt: null },
  cursor: null, pageNumber: 1, requestId: "request", idempotencyKey: "same-key" };
function fixture() {
  let data: unknown = {};
  const store = new PluginStateStore({ async loadData() { return structuredClone(data); }, async saveData(value) { data = structuredClone(value); } }, () => "i");
  return { store, journal: new ImportTasks(store) };
}
const preview = { demo: false, post: { platform: "youtube", contentId: "post", canonicalUrl: "https://example.com/post", text: "Hello",
  author: { id: "creator", displayName: "Creator", handle: "@creator" }, media: [{ id: "media", kind: "video" as const, sourceUrl: "https://example.com/file?token=secret", downloadHeaders: { Authorization: "secret" } }] } };
const manifest = { contentKey: "youtube:post", notePath: "Inbox/post.md", mediaPolicy: "download_all", templateId: "default",
  action: "new", reason: "New note", managedDigest: "digest", expectedOutcome: "complete", partialReasons: [], renderedManagedBlock: "note", frontmatter: {},
  attachments: [{ sourceUrl: "https://example.com/file", mediaId: "media", path: "Inbox/file.mp4", action: "new" }] } as NoteWriteManifest;

describe("Auto Fetch task journal", () => {
  it("projects indexed deliveries once across pages and reopening without losing an earlier failure", async () => {
    const {store, journal} = fixture();
    const page = {fetchId: "page-one", fetchRunId: "run", requestId: "source-request", chargedUnits: 1} as CreatorUpdatePage;
    const write = {manifest, file: {path: manifest.notePath}, ledger: {completion: "complete", status: "saved"},
      attachments: [{mediaId: "media", path: "Inbox/file.mp4", status: "saved"}]} as unknown as VaultWriteResult;
    await journal.recordIndexedDelivery(checkpoint, page, [{preview, write}], [], "2026-10-30T00:00:00.000Z");
    await journal.recordIndexedDelivery(checkpoint, page, [{preview, write: {...write, attachments: [{...write.attachments[0]!, status: "skipped"}]}}], []);
    await journal.recordIndexedDelivery(checkpoint, {...page, fetchId: "page-two"}, [], ["Second page failed"]);
    await journal.recordIndexedDelivery(checkpoint, {...page, fetchId: "page-three"}, [], []);
    const reopened = new ImportTasks(store);
    const tasks = (await reopened.history("a")).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({credits: 3, phase: "failed", error: "Second page failed", requestId: "source-request", time: "2026-10-30T00:00:00.000Z"});
    expect(tasks[0]!.notes).toHaveLength(1);
    expect(tasks[0]!.notes[0]!.files[0]!.phase).toBe("saved");
    expect((await reopened.history("other")).tasks).toEqual([]);
    await reopened.recordIndexedDelivery(checkpoint, {...page, fetchId: "page-two"}, [], []);
    expect((await reopened.history("a")).tasks[0]).toMatchObject({phase: "saved", credits: 3});
    await expect(reopened.recordIndexedDelivery({...checkpoint, accountId: "other"}, page, [], [])).rejects.toThrow("different account");
  });
  it("retains and pages more than 200 completed tasks with scoped, stable cursors", async () => {
    const { store, journal } = fixture();
    const tasks: ImportTask[] = Array.from({ length: 205 }, (_, index) => ({ checkpoint: { ...checkpoint, id: `task-${index}` },
      id: `task-${index}`, accountId: "a", installationId: "i", creatorId: "creator", creatorName: "Creator", folderPath: "Inbox",
      requestId: `request-${index}`, time: new Date(Date.UTC(2026, 0, 1) - index * 60000).toISOString(), phase: "saved",
      notes: [{ key: `text-${index}`, path: `Inbox/${index}.md`, phase: "saved", files: [], preview, manifest }] }));
    await store.update(state => { state.importTasks = tasks; });
    await journal.run(tasks[0]!.checkpoint, async () => true);
    expect((await store.load()).importTasks).toHaveLength(205);
    const first = await journal.history("a");
    expect(first.tasks).toHaveLength(50);
    await expect(journal.history("other", first.nextCursor)).rejects.toThrow("Refresh tasks");
    await expect(journal.history("a", first.nextCursor, "failed")).rejects.toThrow("Refresh tasks");
    const ids = first.tasks.map(task => task.id);
    let cursor = first.nextCursor;
    while (cursor) { const page = await journal.history("a", cursor); ids.push(...page.tasks.map(task => task.id)); cursor = page.nextCursor; }
    expect(ids).toHaveLength(205);
    expect(new Set(ids).size).toBe(205);
    expect(ids.at(-1)).toBe("task-204");
    expect((await journal.recent("a")).length).toBeLessThan(205);
    expect((await journal.history("other")).tasks).toEqual([]);
  });

  it("saves creator snapshots for empty checks and keeps them after unfollowing and restart", async () => {
    const { store, journal } = fixture();
    const creator = { creatorId: "creator", displayName: "Original", platform: "x", avatarUrl: "https://example.com/avatar.jpg", handle: "@original" } as CreatorRecord;
    await journal.rememberCreators([creator], "a");
    await journal.run(checkpoint, async () => true);
    await journal.rememberCreators([{ ...creator, displayName: "Other account" }], "other");
    await journal.rememberCreators([], "a");
    const task = (await new ImportTasks(store).list("a"))[0];
    expect(task).toMatchObject({ creatorName: "Original", platform: "x", avatarUrl: creator.avatarUrl, handle: "@original" });
  });

  it("filters empty successful checks before history pagination without deleting execution records", async () => {
    const { store, journal } = fixture();
    await journal.run(checkpoint, async () => true);
    const empty = (await journal.list("a"))[0]!;
    const content = { key: "text", path: "Inbox/text.md", phase: "saved" as const, files: [], preview, manifest };
    await store.update(state => { state.importTasks = [
      ...Array.from({ length: 61 }, (_, index) => ({ ...empty, id: `empty-${index}`, phase: index % 2 ? "skipped" as const : "saved" as const })),
      ...Array.from({ length: 51 }, (_, index) => ({ ...empty, id: `text-${index}`, notes: [content] })),
      { ...empty, id: "failed", phase: "failed" }, { ...empty, id: "checking", phase: "checking" }, { ...empty, id: "cancelled", phase: "cancelled" }
    ]; });
    const restored = new ImportTasks(store);
    const first = await restored.history("a");
    expect(first.tasks).toHaveLength(50);
    expect(first.tasks.some(task => task.id.startsWith("empty-"))).toBe(false);
    const second = await restored.history("a", first.nextCursor);
    expect(second.tasks).toHaveLength(4);
    expect(second.nextCursor).toBeUndefined();
    const ids = [...first.tasks, ...second.tasks].map(task => task.id);
    expect(ids).toEqual(expect.arrayContaining(["failed", "checking", "cancelled", "text-50"]));
    expect((await restored.history("a", undefined, "failed")).tasks.map(task => task.id)).toEqual(["failed"]);
    expect((await restored.get("empty-0", "a")).notes).toEqual([]);
    expect((await store.load()).importTasks).toHaveLength(115);
  });

  it("counts authoritative page charges once across retries and sums different pages", async () => {
    const { journal } = fixture();
    await journal.run(checkpoint, async context => {
      const page = { fetchId: "one", fetchRunId: "run", requestId: "request", chargedUnits: 1, usage: { units: 9 } } as CreatorUpdatePage;
      await journal.page(context, page);
      await journal.page(context, { ...page, chargedUnits: 0 });
      expect((await journal.list("a"))[0]?.credits).toBe(1);
      await journal.page(context, { ...page, fetchId: "two", requestId: "second-request", chargedUnits: 2 });
      expect((await journal.list("a"))[0]).toMatchObject({ credits: 3, requestId: "request" });
      return true;
    });
  });

  it("records source failures independently from local write failures", async () => {
    const { journal } = fixture();
    await expect(journal.run(checkpoint, async context => {
      await journal.fetching(context);
      throw new Error("Source unavailable");
    })).rejects.toThrow("Source unavailable");
    expect((await journal.list("a"))[0]).toMatchObject({ phase: "failed", fetchError: "Source unavailable" });
    await expect(journal.run(checkpoint, async context => {
      await journal.beginNote(context, preview, manifest);
      throw new Error("Disk unavailable");
    }, true)).rejects.toThrow("Disk unavailable");
    expect((await journal.list("a"))[0]?.fetchError).toBeUndefined();
  });

  it("publishes byte progress, persists lifecycle and hides another account", async () => {
    const { store, journal } = fixture();
    const listener = vi.fn(); journal.subscribe(listener);
    await journal.run(checkpoint, async context => {
      await journal.beginNote(context, preview, manifest);
      journal.progress(context, "youtube:post", "media", { receivedBytes: 1024 }, "downloading");
      const current = (await journal.list("a"))[0]!;
      expect(current.notes[0]!.files[0]).toMatchObject({ receivedBytes: 1024, phase: "downloading" });
      expect(importStatus([current])).toBe("importing");
      await journal.endNote(context, "youtube:post", undefined, new Error("Disk unavailable"));
      return true;
    });
    expect(listener).toHaveBeenCalled();
    expect(importStatus(await journal.list("a"))).toBe("failed");
    expect(await journal.list("other")).toEqual([]);
    expect(JSON.stringify(await store.load())).not.toContain("secret");
    const restored = new ImportTasks(store);
    expect((await restored.list("a"))[0]).toMatchObject({ platform: "youtube", handle: "@creator" });
    expect((await restored.list("a"))[0]?.notes[0]?.files[0]?.error).toBe("Disk unavailable");
  });

  it("cancels a running operation and never automatically resumes it", async () => {
    const { journal, store } = fixture();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const running = journal.run(checkpoint, async context => {
      started();
      await new Promise<void>(resolve => context.signal.addEventListener("abort", () => resolve(), { once: true }));
      context.signal.throwIfAborted();
      return true;
    });
    const rejected = expect(running).rejects.toBeDefined();
    await ready;
    await expect(journal.cancel("task-1", "other")).rejects.toThrow("current account");
    await journal.cancel("task-1", "a");
    await rejected;
    const automatic = vi.fn(async () => true);
    await journal.run(checkpoint, automatic);
    expect(automatic).not.toHaveBeenCalled();
    await new ImportTasks(store).run(checkpoint, automatic);
    expect(automatic).not.toHaveBeenCalled();
    expect((await journal.list("a"))[0]?.phase).toBe("cancelled");
    await journal.run(checkpoint, automatic, true);
    expect(automatic).toHaveBeenCalledOnce();
  });

  it("shows restored unfinished tasks as waiting rather than completed", async () => {
    const { store } = fixture();
    await store.update(state => { state.importTasks = [{ checkpoint, id: checkpoint.id, accountId: "a", installationId: "i", creatorId: "creator",
      creatorName: "Creator", folderPath: "Inbox", requestId: "request", time: new Date().toISOString(), phase: "downloading", notes: [] }]; });
    const tasks = await new ImportTasks(store).list("a");
    expect(tasks[0]?.phase).toBe("waiting");
    expect(importStatus(tasks)).toBe("importing");
  });

  it("gives active tasks priority and expires the recent-failure indicator after 24 hours", async () => {
    const { journal } = fixture();
    await journal.run(checkpoint, async () => true);
    const task = (await journal.list("a"))[0]!;
    const now = Date.now();
    expect(importStatus([{ ...task, phase: "failed", lastFailureAt: new Date(now - 1000).toISOString() }], now)).toBe("failed");
    expect(importStatus([{ ...task, phase: "failed", lastFailureAt: new Date(now - 86_400_001).toISOString() }], now)).toBe("completed");
    expect(importStatus([{ ...task, phase: "downloading", lastFailureAt: new Date().toISOString() }])).toBe("importing");
  });
});
