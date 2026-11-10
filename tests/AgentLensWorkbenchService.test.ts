import type {NativeExecutionTarget} from "../src/runtime/NativeExecutionTarget";
import { describe, expect, it, vi } from "vitest";
import { AgentLensWorkbenchService, DEMO_URL, type PreviewResult } from "@/workbench/AgentLensWorkbenchService";
import type { AgentLensApiPort } from "@/workbench/ports";
import { AuthService, type AuthApi, type RefreshTokenPersistence } from "@/auth/AuthService";
import { PluginStateStore, type PluginDataAdapter } from "@/runtime/PluginStateStore";
import { VaultWriter, type VaultFileRef, type VaultPort } from "@/vault/VaultWriter";
import { userMessage } from "@/core/user-feedback";
import { AgentLensError } from "@/core/errors";
import { MediaDownloadError, MediaRecoveryError } from "@/core/mediaFailure";
import type { CreatorRecord } from "@/api/AgentLensApiClient";
import type { AccountCapabilities } from "@/api/contracts";

class MemoryVault implements VaultPort {
  files = new Map<string, string>();
  binaryFiles = new Map<string, ArrayBuffer>();
  frontmatter = new Map<string, Readonly<Record<string, unknown>>>();
  keysByPath = new Map<string, string>();
  getFile(path: string): VaultFileRef | null { return this.files.has(path) ? { path } : null; }
  async readText(file: VaultFileRef) { return this.files.get(file.path) ?? ""; }
  async createText(path: string, content: string) { this.files.set(path, content); return { path }; }
  async modifyText(file: VaultFileRef, content: string) { this.files.set(file.path, content); }
  async ensureFolder() {}
  async createBinary(path: string, data?: ArrayBuffer) { this.files.set(path, "<binary>"); if (data) this.binaryFiles.set(path, data.slice(0)); return { path }; }
  async updateFrontmatter(file: VaultFileRef, values: Readonly<Record<string, unknown>>) { this.frontmatter.set(file.path, values); }
  async recordNoteIdentity(file: VaultFileRef, key: string) { this.keysByPath.set(file.path, key); }
  async matchesAgentLensKey(file: VaultFileRef, key: string, sourceUrl: string) {
    const indexed = this.keysByPath.get(file.path);
    if (indexed) return indexed === key;
    const values = this.frontmatter.get(file.path);
    return values?.Source_url === sourceUrl && String(values.Platform).toLowerCase() === key.split(":")[0];
  }
  async findByAgentLensKey(folderPath: string, key: string, sourceUrl: string): Promise<VaultFileRef | null> {
    let path: string | undefined;
    for (const candidate of this.frontmatter.keys()) {
      if (!path && candidate.startsWith(`${folderPath}/`) && await this.matchesAgentLensKey({ path: candidate }, key, sourceUrl)) path = candidate;
    }
    return path ? { path } : null;
  }
}

function demoPage() {
  return {
    fetchId: "demo-server-result", mode: "single_post" as const, platform: "x",
    content: [{ platform: "x", contentId: "2109991777361101135", canonicalUrl: DEMO_URL,
      text: "Server demo content", author: { id: "spacex", displayName: "SpaceX" }, media: [] }],
    page: null, usage: { charged: false, units: 0, remaining: null }
  };
}

function apiPort(overrides: Partial<AgentLensApiPort> = {}): AgentLensApiPort {
  const unused = async (): Promise<never> => { throw new Error("Unused test API method."); };
  return {
    demoFetch: vi.fn(async () => demoPage()),
    getExecution: unused,
    inspectExecutionRecovery: unused,
    resumeUnstartedExecution: unused,
    autoFetchCapabilities: async () => ({ minuteFrequencyAvailable: false, minuteFrequencyMaxEvery: 59, minuteCreatorLimit: 10, minuteCreatorUsed: 0 }),
    currentClientVersion: () => "0.1.0",
    capabilities: unused,
    account: unused,
    activity: unused,
    activityDetail: unused,
    scheduleHistory: unused,
    accountFollows: unused,
    unfollowAccount: unused,
    exportActivity: unused,
    settings: unused,
    confirmTimezone: unused,
    parseCreator: unused,
    createCreator: unused,
    listCreators: unused,
    updateCreator: unused,
    previewCreatorSettings: unused,
    updateCreatorSettings: unused,
    deleteCreator: unused,
    fetch: unused,
    baselineImport: unused,
    reconcile: unused,
    manualCreatorUpdates: unused,
    creatorUpdates: unused,
    refreshMedia: unused,
    writeResults: unused,
    ...overrides
  };
}

function capabilities(overrides: Partial<AccountCapabilities> = {}): AccountCapabilities {
  return {
    accountId: "account-1",
    plan: "pro",
    quotaRemaining: 10,
    minimumPluginVersion: "0.1.0",
    latestPluginVersion: "0.1.0",
    supportUrl: "https://agentlens.example/support",
    releaseNotesUrl: "https://agentlens.example/releases",
    platforms: [],
    ...overrides
  };
}

function service(overrides: Partial<AgentLensApiPort> = {}, signedIn = false, executionTarget?: () => Promise<NativeExecutionTarget | undefined>) {
  let data: unknown = {};
  const adapter: PluginDataAdapter = {
    async loadData() { return structuredClone(data); },
    async saveData(value) { data = structuredClone(value); }
  };
  const state = new PluginStateStore(adapter, () => "install-1");
  const authApi: AuthApi = {
    startDeviceAuthorization: vi.fn(),
    pollDeviceAuthorization: vi.fn(),
    refresh: vi.fn(async () => ({ accessToken: "access", expiresIn: 3600 })),
    revoke: vi.fn()
  };
  const tokens: RefreshTokenPersistence = {
    async load() { return signedIn ? "refresh" : null; },
    async save() {},
    async clear() {}
  };
  const api = apiPort({ writeResults: vi.fn(), ...overrides });
  const vault = new MemoryVault();
  return {
    workbench: new AgentLensWorkbenchService(
      new AuthService(authApi, tokens),
      api,
      new VaultWriter(vault, { folderPath: "AgentLens/Inbox" }),
      state,
      () => "id-1", undefined, undefined, undefined, undefined, executionTarget),
    readData: () => data,
    vault,
    api
  };
}

describe("AgentLensWorkbenchService", () => {
  it.each(["single", "profile"])("does not reuse or deliver a pending %s parse after sign-out", async mode => {
    let finish!: (page: ReturnType<typeof demoPage>) => void;
    const fetch = vi.fn(async () => demoPage()).mockImplementationOnce(() => new Promise<ReturnType<typeof demoPage>>(resolve => { finish = resolve; }));
    const fixture = service({ fetch, capabilities: async () => capabilities() }, true);
    await fixture.workbench.restoreAuth();
    const parse = () => mode === "single" ? fixture.workbench.previewSingle("https://youtube.com/watch?v=live")
      : fixture.workbench.fetchProfilePage("https://youtube.com/@creator", null);
    const pending = parse();
    const rejected = pending.catch(error => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await fixture.workbench.signOut();
    await fixture.workbench.restoreAuth();
    await parse();
    expect(fetch).toHaveBeenCalledTimes(2);
    finish(demoPage());
    expect(await rejected).toEqual(expect.objectContaining({ message: expect.stringContaining("account changed") }));
  });

  it("persists continuation identity after a non-retryable page error", async () => {
    const fetch = vi.fn(async () => { throw new AgentLensError("unknown", "Invalid cursor", false, 400); });
    const fixture = service({ fetch, capabilities: async () => capabilities() }, true);
    await expect(fixture.workbench.fetchProfilePage("https://youtube.com/@creator", "ppc1.next"))
      .rejects.toThrow("Invalid cursor");
    expect(JSON.stringify(fixture.readData())).toContain('"kind":"remote_action"');
    await expect(fixture.workbench.fetchProfilePage("https://youtube.com/@creator", "ppc1.next"))
      .rejects.toThrow("Invalid cursor");
    expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[0]);
  });

  it("requires a restored access token for each billing request", async () => {
    const plans = vi.fn(async () => []);
    const billing = vi.fn(() => ({ plans } as unknown as import("@/api/billing").BillingPort));
    const fixture = service({ billing }, true);
    await fixture.workbench.billing.plans();
    expect(billing).toHaveBeenCalledWith("access");
    expect(plans).toHaveBeenCalledTimes(1);
    await expect(service({ billing }).workbench.billing.plans()).rejects.toThrow();
    expect(plans).toHaveBeenCalledTimes(1);
  });
  it("unfollows under authentication and version gates without changing durable local data", async () => {
    const unfollowAccount = vi.fn(async () => undefined);
    const fixture = service({ unfollowAccount, capabilities: async () => capabilities() }, true);
    await fixture.workbench.unfollowAccount("follow");
    expect(unfollowAccount).toHaveBeenCalledExactlyOnceWith("access", "follow");
    expect(fixture.readData()).toEqual({});
    await expect(service({ unfollowAccount }).workbench.unfollowAccount("follow")).rejects.toThrow();
    await expect(service({ unfollowAccount, capabilities: async () => capabilities({ minimumPluginVersion: "9.0.0" }) }, true).workbench.unfollowAccount("follow")).rejects.toThrow();
    expect(unfollowAccount).toHaveBeenCalledTimes(1);
  });
  it("discovers account follows only after restoring an authenticated session", async () => {
    const accountFollows = vi.fn(async () => []);
    const fixture = service({ accountFollows }, true);
    expect(await fixture.workbench.accountFollows()).toEqual([]);
    expect(accountFollows).toHaveBeenCalledWith("access");
    expect(fixture.readData()).toEqual({});
    await expect(service({ accountFollows }).workbench.accountFollows()).rejects.toThrow();
    expect(accountFollows).toHaveBeenCalledTimes(1);
  });

  it("reads schedule history under the restored session without creating durable work", async () => {
    const history = { followId: "follow", throughRevision: 2, revisions: [], nextAfterRevision: null };
    const scheduleHistory = vi.fn(async () => history);
    const fixture = service({ scheduleHistory }, true);
    expect(await fixture.workbench.scheduleHistory("follow", 1, 2)).toBe(history);
    expect(scheduleHistory).toHaveBeenCalledWith("access", "follow", 1, 2);
    expect(fixture.readData()).toEqual({});
    const signedOut = service({ scheduleHistory });
    await expect(signedOut.workbench.scheduleHistory("follow")).rejects.toThrow();
    expect(scheduleHistory).toHaveBeenCalledTimes(1);
  });

  it("lets the server judge new domains even when the cached capabilities contain no platform", async () => {
    const serverError = new AgentLensError("unknown", "Server rejected the platform", false);
    const fetch = vi.fn(async () => { throw serverError; });
    const fixture = service({ fetch, capabilities: async () => capabilities() }, true);
    await expect(fixture.workbench.previewSingle("分享 http://new-social.example/post/1 复制打开"))
      .rejects.toBe(serverError);
    expect(fetch).toHaveBeenCalledWith("access", { url: "http://new-social.example/post/1", mode: "single_post" },
      expect.any(String), expect.any(String));
  });

  it("sends the reported Douyin share URLs through the real service boundary", async () => {
    const fetch = vi.fn(async () => ({fetchId: "fetch-douyin", content: [{
      platform: "douyin", contentId: "post-1", canonicalUrl: "https://v.douyin.com/4a9qaT01UYA/",
      text: "全部学错", author: {id: "creator", displayName: "Creator"}, media: []
    }], usage: {charged: true, units: 1, remaining: 9}})) as unknown as AgentLensApiPort["fetch"];
    const fixture = service({fetch, capabilities: async () => capabilities({platforms: [
      {id: "douyin", label: "Douyin", available: true, single: true, profile: true, autoFetch: false, profileScope: "creator", mediaDownload: true, transcript: false}
    ]})}, true);
    await fixture.workbench.previewSingle("分享文案 https://v.douyin.com/4a9qaT01UYA/ 复制此链接，打开Dou音搜索");
    expect(fetch).toHaveBeenCalledWith("access", {url: "https://v.douyin.com/4a9qaT01UYA/", mode: "single_post"}, expect.any(String), expect.any(String));
    await fixture.workbench.previewSingle("https://v.douyin.com/zY0uzGHENoI/");
    expect(fetch).toHaveBeenLastCalledWith("access", {url: "https://v.douyin.com/zY0uzGHENoI/", mode: "single_post"}, expect.any(String), expect.any(String));
  });

  it("coalesces concurrent baseline imports and reuses the request after a local failure", async () => {
    const creator: CreatorRecord = {
      creatorId: "creator", platform: "youtube", profileUrl: "https://youtube.com/@creator", displayName: "Creator",
      handle: null, avatarUrl: null, saveFolderPath: "History", noteTemplateId: "compact", mediaPolicy: "link_only",
      autoFetchEnabled: true, frequency: { every: 1, unit: "week" }, timezone: "UTC", preferredTimes: [],
      nextCheckAt: "2026-09-19T00:00:00Z", lastCheckedAt: null, lastUpdateAt: null, lastResult: null, lastError: null,
      importedCount: 0, schedulerState: "scheduled", retryAt: null, activeJobId: null, activeJobTrigger: null
    };
    const baselineImport = vi.fn(async () => ({
      fetchId: "history", mode: "profile_page" as const, platform: "youtube", content: [],
      page: { cursor: null, hasMore: false, pageNumber: 1 }, usage: { charged: true, units: 1, remaining: 9 }
    }));
    const { workbench, readData } = service({ baselineImport, capabilities: async () => capabilities() }, true);
    const failed = { successes: [], failures: [{ preview: { demo: false, post: {
      platform: "youtube", contentId: "failed", canonicalUrl: "https://youtube.com/watch?v=failed", text: "source", author: { id: "creator", displayName: "Creator" }, media: []
    } }, error: "disk full" }] };
    const saveMany = vi.spyOn(workbench, "saveMany").mockResolvedValue(failed);
    await Promise.all([workbench.importCreatorBaseline(creator), workbench.importCreatorBaseline(creator)]);
    expect(baselineImport).toHaveBeenCalledTimes(1);
    expect(saveMany).toHaveBeenCalledTimes(1);
    const first = baselineImport.mock.calls[0];
    expect(JSON.stringify(readData())).toContain("remote_action");
    saveMany.mockResolvedValue({ successes: [], failures: [] });
    await workbench.importCreatorBaseline(creator);
    expect(baselineImport.mock.calls[1]).toEqual(first);
    expect(JSON.stringify(readData())).not.toContain("remote_action");
    expect(creator.nextCheckAt).toBe("2026-09-19T00:00:00Z");
  });

  it("previews server demo and saves without billing or callbacks", async () => {
    const fixture = service();
    const preview = await fixture.workbench.previewSingle(DEMO_URL);
    const manifest = await fixture.workbench.plan(preview.post);
    const saved = await fixture.workbench.save(preview, manifest);

    expect(preview.demo).toBe(true);
    expect(saved.callback).toBe("not_required");
    expect(fixture.api.writeResults).not.toHaveBeenCalled();
    expect(JSON.stringify(fixture.readData())).toContain("x:2109991777361101135");
    expect(fixture.api.demoFetch).toHaveBeenCalledWith("single_post");
  });

  it("uses normal authenticated fetch for the demo URL after login", async () => {
    const fetch = vi.fn(async () => demoPage());
    const fixture = service({ fetch, capabilities: async () => capabilities() }, true);
    expect((await fixture.workbench.previewSingle(DEMO_URL)).demo).toBe(false);
    expect(fetch).toHaveBeenCalled();
    expect(fixture.api.demoFetch).not.toHaveBeenCalled();
  });

  it("fetches anonymous profile pages only for the fixed demo creator", async () => {
    const fixture = service();
    await fixture.workbench.fetchProfilePage("https://x.com/spaceX/", null);
    await fixture.workbench.fetchProfilePage("https://x.com/spaceX/", "snapshot-id");
    expect(fixture.api.demoFetch).toHaveBeenNthCalledWith(1, "profile_page", null);
    expect(fixture.api.demoFetch).toHaveBeenNthCalledWith(2, "profile_page", "snapshot-id");
    await expect(fixture.workbench.fetchProfilePage("https://x.com/other/", null)).rejects.toThrow(/Sign in/);
    expect(JSON.stringify(fixture.readData())).not.toContain("remote_action");
  });

  it("requires sign-in for non-demo URLs", async () => {
    const fixture = service();
    await expect(fixture.workbench.previewSingle("https://example.com/live"))
      .rejects.toThrow(/Sign in/);
  });

  it("deduplicates concurrent writes for the same stable content key", async () => {
    const fixture = service();
    const preview = await fixture.workbench.previewSingle(DEMO_URL);
    const manifest = await fixture.workbench.plan(preview.post);

    const [first, second] = await Promise.all([
      fixture.workbench.save(preview, manifest),
      fixture.workbench.save(preview, manifest)
    ]);

    expect(first.write.file.path).toBe(second.write.file.path);
    expect(first.write.ledger.managedDigest).toBe(second.write.ledger.managedDigest);
  });

  it("keeps the first receipt when saving a second manual copy fails", async () => {
    const fixture = service();
    const preview = await fixture.workbench.previewSingle(DEMO_URL);
    const first = await fixture.workbench.save(preview,
      await fixture.workbench.planPreview(preview, { saveAsCopy: true }));
    const second = await fixture.workbench.planPreview(preview, { saveAsCopy: true });
    expect(second.notePath).toMatch(/_02\.md$/);
    fixture.vault.createText = async () => { throw new Error("disk full"); };

    await expect(fixture.workbench.save(preview, second)).rejects.toThrow("disk full");
    const ledger = (fixture.readData() as { agentlensState: { ledger: Record<string, { notePath: string; status: string }> } }).agentlensState.ledger;
    expect(ledger[first.write.ledger.contentKey]).toMatchObject({ notePath: first.write.file.path, status: "written" });
  });

  it("saves concurrent same-title posts to distinct paths without serializing their downloads", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({ loadData: async () => structuredClone(data), saveData: async value => { data = structuredClone(value); } }, () => "same-title");
    const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
      { load: async () => null, save: async () => {}, clear: async () => {} });
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Inbox" });
    let releaseDownloads!: () => void;
    const gate = new Promise<void>(resolve => { releaseDownloads = resolve; });
    const download = vi.fn(async () => { await gate; return new ArrayBuffer(2); });
    const workbench = new AgentLensWorkbenchService(auth, apiPort(), writer, state, () => crypto.randomUUID(), { download });
    const entries = await Promise.all(["one", "two"].map(async id => {
      const post = { platform: "weibo", contentId: id, title: "Same title", text: id,
        canonicalUrl: "https://weibo.com/creator/" + id, author: { id: "creator", displayName: "Creator" },
        media: [{ id, kind: "image" as const, sourceUrl: "https://cdn.example/" + id + ".jpg" }] };
      return { preview: { post, demo: true }, manifest: await writer.plan(post, { saveAsCopy: true }) };
    }));
    expect(entries[0]!.manifest.notePath).toBe(entries[1]!.manifest.notePath);
    const saving = workbench.savePrepared(entries);
    try {
      await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
    } finally { releaseDownloads(); }
    const result = await saving;
    expect(result.failures).toEqual([]);
    expect(result.successes.map(item => item.write.file.path).sort()).toEqual([
      entries[0]!.manifest.notePath, entries[0]!.manifest.notePath.replace(/\.md$/, "_02.md")
    ]);
    for (const { write } of result.successes) {
      expect(write.attachments).toEqual([expect.objectContaining({ status: "saved" })]);
      expect(vault.frontmatter.get(write.file.path)?.Source_url).toBe(write.ledger.sourceUrl);
      expect(vault.keysByPath.get(write.file.path)).toBe(write.ledger.contentKey);
    }
    expect((await state.load()).pendingActions).toEqual([]);
  });

  it("executes the reviewed immutable batch manifest and reports note and attachment progress", async () => {
    const fixture = service();
    const preview = await fixture.workbench.previewSingle(DEMO_URL);
    const manifest = await fixture.workbench.plan(preview.post);
    const progress: string[] = [];

    const result = await fixture.workbench.savePrepared(
      [{ preview, manifest }],
      (_contentKey, status) => progress.push(status)
    );

    expect(result.successes).toHaveLength(1);
    expect(result.failures).toEqual([]);
    expect(progress[0]).toContain("Writing note");
    expect(progress.at(-1)).toContain("written");
    expect(result.successes[0]?.write.manifest).toBe(manifest);
  });

  it("replays durable result callbacks and removes only acknowledged actions", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    await state.load();
    await state.update((current) => current.pendingActions.push({
      id: "callback-1",
      kind: "result_callback",
      createdAt: "2026-08-20T00:00:00Z",
      payload: {
        idempotencyKey: "callback-idempotency-1",
        request: {
          fetchId: "fetch-1",
          runId: "run-1",
          creatorId: "creator-1",
          fetchRunId: "run-1",
          results: [{ contentKey: "youtube:post-1", notePath: "AgentLens/Inbox/post-1.md", status: "success" }]
        }
      }
    }));
    const writeResults = vi.fn(async () => ({ accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 }));
    const workbench = new AgentLensWorkbenchService(
      new AuthService({
        startDeviceAuthorization: vi.fn(),
        pollDeviceAuthorization: vi.fn(),
        refresh: vi.fn(),
        revoke: vi.fn()
      }, {
        async load() { return null; }, async save() {}, async clear() {}
      }),
      apiPort({ writeResults }),
      new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" }),
      state
    );

    await expect(workbench.flushPendingCallbacks("access-1")).resolves.toBe(1);
    expect(writeResults).toHaveBeenCalledWith("access-1", expect.objectContaining({ runId: "run-1" }), "callback-idempotency-1");
    expect((await state.load()).pendingActions).toEqual([]);
    expect((await state.load()).creatorDiagnostics["creator-1"]).toMatchObject({ lastSavedCount: 1, countedPages: ["run-1:fetch-1"] });
    await expect(workbench.flushPendingCallbacks("access-1")).resolves.toBe(0);
    expect((await state.load()).creatorDiagnostics["creator-1"]?.lastSavedCount).toBe(1);
  });

  it("replays a durable failed Vault write before scheduler reconciliation", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    await state.load();
    await state.update((current) => current.pendingActions.push({
      id: "write-1",
      kind: "write_manifest",
      createdAt: "2026-08-20T00:00:00Z",
      payload: {
        preview: {
          fetchId: "fetch-1",
          demo: false,
          post: {
            platform: "youtube", contentId: "retry-1", canonicalUrl: "https://youtu.be/retry-1",
            text: "Recovered source", author: { id: "creator-1", displayName: "Creator" }, media: []
          }
        },
        options: { folderPath: "AgentLens/Recovered", templateId: "default", mediaPolicy: "link_only" },
        request: {
          fetchId: "fetch-1", runId: "lease-1", creatorId: "creator-1", fetchRunId: "lease-1",
          results: [{ contentKey: "youtube:retry-1", notePath: "AgentLens/Recovered/retry-1.md", status: "failed" }]
        },
        idempotencyKey: "retry-write-1"
      }
    }));
    const vault = new MemoryVault();
    const writeResults = vi.fn(async () => ({ accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 }));
    const workbench = new AgentLensWorkbenchService(
      new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(), revoke: vi.fn() }, {
        async load() { return null; }, async save() {}, async clear() {}
      }),
      apiPort({ writeResults }),
      new VaultWriter(vault, { folderPath: "AgentLens/Inbox" }),
      state,
      () => "id-1",
      undefined,
      (options) => new VaultWriter(vault, {
        folderPath: options.folderPath ?? "AgentLens/Inbox",
        templateId: options.templateId,
        mediaPolicy: options.mediaPolicy
      })
    );

    await expect(workbench.flushPendingWrites("access-1")).resolves.toBe(1);
    expect([...vault.files.keys()].some((path) =>
      path.startsWith("AgentLens/Recovered/") && path.includes("Recovered_source") && path.endsWith(".md")
    )).toBe(true);
    expect(writeResults).toHaveBeenCalledWith("access-1", expect.objectContaining({
      results: [expect.objectContaining({ contentKey: "youtube:retry-1", status: "success" })]
    }), "retry-write-1");
    expect((await state.load()).pendingActions).toEqual([]);
    expect((await state.load()).creatorDiagnostics["creator-1"]).toMatchObject({ lastSavedCount: 1 });
  });

  it("persists a local write intent before touching the note and resumes after a note-to-attachment interruption", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    class InterruptingVault extends MemoryVault {
      interrupted = false;
      sawPendingIntent = false;

      override async createText(path: string, content: string): Promise<VaultFileRef> {
        if (!this.interrupted) {
          this.sawPendingIntent = (await state.load()).pendingActions.some((action) => action.kind === "write_manifest");
          this.files.set(path, content);
          this.interrupted = true;
          throw new Error("host exited after the note write");
        }
        return super.createText(path, content);
      }
    }
    const vault = new InterruptingVault();
    const mediaDownloader = {
      async download() { return new Uint8Array([1, 2, 3]).buffer; }
    };
    const workbench = new AgentLensWorkbenchService(
      new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(), revoke: vi.fn() }, {
        async load() { return null; }, async save() {}, async clear() {}
      }),
      apiPort({ writeResults: vi.fn() }),
      new VaultWriter(vault, { folderPath: "AgentLens/Inbox" }),
      state,
      () => "id-1",
      mediaDownloader
    );
    const preview: PreviewResult = {
      demo: true,
      post: {
        platform: "youtube",
        contentId: "interrupt-1",
        canonicalUrl: "https://youtube.com/watch?v=interrupt-1",
        text: "Recover me",
        author: { id: "creator-1", displayName: "Creator" },
        media: [{ id: "image-1", kind: "image", sourceUrl: "https://cdn.example/image.jpg" }]
      }
    };
    const manifest = await workbench.planPreview(preview);

    await expect(workbench.save(preview, manifest)).rejects.toThrow("host exited");
    expect(vault.sawPendingIntent).toBe(true);
    expect((await state.load()).pendingActions).toEqual([expect.objectContaining({ kind: "write_manifest" })]);

    await expect(workbench.flushPendingWrites()).resolves.toBe(1);
    expect([...vault.files.keys()].filter((path) => path.endsWith(".md"))).toHaveLength(1);
    expect([...vault.files.keys()].some((path) => path.includes("attachments/") && path.endsWith(".jpg"))).toBe(true);
    expect((await state.load()).pendingActions).toEqual([]);
  });

  it("persists a result callback before sending it and clears it only after acknowledgement", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    let sawDurableCallback = false;
    const writeResults = vi.fn(async () => {
      sawDurableCallback = (await state.load()).pendingActions.some((action) => action.kind === "result_callback");
      return { accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 };
    });
    const auth = new AuthService({
      startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })), revoke: vi.fn()
    }, { async load() { return "refresh-1"; }, async save() {}, async clear() {} });
    const workbench = new AgentLensWorkbenchService(
      auth,
      apiPort({ writeResults }),
      new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" }),
      state,
      () => "id-1"
    );
    const preview: PreviewResult = {
      fetchId: "fetch-1",
      demo: false,
      post: {
        platform: "youtube", contentId: "callback-1", canonicalUrl: "https://youtube.com/watch?v=callback-1",
        text: "Callback source", author: { id: "creator-1", displayName: "Creator" }, media: []
      }
    };

    await expect(workbench.save(preview, await workbench.planPreview(preview))).resolves.toMatchObject({ callback: "acknowledged" });
    expect(sawDurableCallback).toBe(true);
    expect((await state.load()).pendingActions).toEqual([]);
  });

  it("signs out without deleting the Vault note or its local write ledger", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    const vault = new MemoryVault();
    const clear = vi.fn(async () => undefined);
    const revoke = vi.fn(async () => undefined);
    let refreshToken: string | null = null;
    const workbench = new AgentLensWorkbenchService(
      new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(), revoke }, {
        async load() { return refreshToken; }, async save() {}, clear
      }),
      apiPort({ writeResults: vi.fn() }),
      new VaultWriter(vault, { folderPath: "AgentLens/Inbox" }),
      state,
      () => "id-1"
    );
    const preview = await workbench.previewSingle(DEMO_URL);
    const saved = await workbench.save(preview, await workbench.planPreview(preview));
    const ledgerBefore = structuredClone((await state.load()).ledger);
    refreshToken = "refresh-1";

    await workbench.signOut();

    expect(revoke).toHaveBeenCalledWith("refresh-1");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(vault.files.has(saved.write.file.path)).toBe(true);
    expect((await state.load()).ledger).toEqual(ledgerBefore);
  });

  it("does not treat a prerelease as satisfying a stable minimum before a paid fetch", async () => {
    const fetch = vi.fn();
    const { workbench } = service({
      currentClientVersion: () => "0.2.0-beta.10",
      capabilities: async () => capabilities({ minimumPluginVersion: "0.2.0" }),
      fetch
    }, true);
    await expect(workbench.previewSingle("https://youtube.com/watch?v=blocked"))
      .rejects.toThrow(/0\.2\.0 or newer/);
    const failure = await workbench.previewSingle("https://youtube.com/watch?v=blocked").catch(error => error);
    expect(userMessage(failure)).toBe("Update the AgentLens plugin to continue.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the server requires a newer plugin version", async () => {
    const auth = new AuthService({
      startDeviceAuthorization: vi.fn(),
      pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })),
      revoke: vi.fn()
    }, {
      async load() { return "refresh-1"; }, async save() {}, async clear() {}
    });
    const api = apiPort({
      capabilities: vi.fn(async () => capabilities({ minimumPluginVersion: "0.2.0" })),
      currentClientVersion: vi.fn(() => "0.1.0")
    });
    const workbench = new AgentLensWorkbenchService(
      auth,
      api,
      new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" }),
      new PluginStateStore({ async loadData() { return {}; }, async saveData() {} })
    );

    await expect(workbench.capabilities()).resolves.toMatchObject({ minimumPluginVersion: "0.2.0" });
    await expect(workbench.previewSingle("https://youtube.com/watch?v=blocked"))
      .rejects.toThrow(/0\.2\.0 or newer/);
  });

  it("reuses a persisted idempotency key and request id after a network failure and restart", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    const fetch = vi.fn()
      .mockRejectedValueOnce(new AgentLensError("network_unavailable", "offline", true, undefined, undefined, "transport-1"))
      .mockResolvedValueOnce({
        fetchId: "fetch-1",
        mode: "single_post",
        platform: "youtube",
        content: [{
          platform: "youtube", contentId: "post-1", canonicalUrl: "https://youtube.com/watch?v=post-1",
          text: "Post", author: { id: "creator-1", displayName: "Creator" }, media: []
        }],
        page: null,
        usage: { charged: true, units: 1, remaining: 9 }
      });
    const api = apiPort({
      capabilities: vi.fn(async () => capabilities({
        platforms: [{ id: "youtube", label: "YouTube", single: true, profile: true, autoFetch: true, profileScope: "creator", mediaDownload: true, transcript: true, available: true }]
      })),
      currentClientVersion: vi.fn(() => "0.1.0"),
      fetch
    });
    const createAuth = () => new AuthService({
      startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })), revoke: vi.fn()
    }, { async load() { return "refresh-1"; }, async save() {}, async clear() {} });
    let sequence = 0;
    const createWorkbench = () => new AgentLensWorkbenchService(
      createAuth(), api, new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" }),
      state, () => `generated-${++sequence}`
    );

    await expect(createWorkbench().previewSingle("https://youtube.com/watch?v=post-1")).rejects.toThrow("offline");
    const pendingAfterFailure = (await state.load()).pendingActions;
    expect(pendingAfterFailure).toHaveLength(1);
    expect(pendingAfterFailure[0]).toMatchObject({ kind: "remote_action" });

    await expect(createWorkbench().previewSingle("https://youtube.com/watch?v=post-1")).resolves.toMatchObject({ fetchId: "fetch-1" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[2]).toBe(fetch.mock.calls[1]?.[2]);
    expect(fetch.mock.calls[0]?.[3]).toBe(fetch.mock.calls[1]?.[3]);
    expect((await state.load()).pendingActions).toEqual([]);
  });

  it("clears a persisted remote action after a non-retryable server rejection", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    const api = apiPort({
      capabilities: vi.fn(async () => capabilities({
        platforms: [{ id: "youtube", label: "YouTube", single: true, profile: true, autoFetch: true, profileScope: "creator", mediaDownload: true, transcript: true, available: true }]
      })),
      currentClientVersion: vi.fn(() => "0.1.0"),
      fetch: vi.fn(async () => { throw new AgentLensError("forbidden", "Not allowed", false, 403); })
    });
    const auth = new AuthService({
      startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })), revoke: vi.fn()
    }, { async load() { return "refresh-1"; }, async save() {}, async clear() {} });
    const workbench = new AgentLensWorkbenchService(
      auth, api, new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" }), state, () => "id-1"
    );

    await expect(workbench.previewSingle("https://youtube.com/watch?v=post-1")).rejects.toThrow("Not allowed");
    expect((await state.load()).pendingActions).toEqual([]);
  });

  it("reuses scheduler reconcile identifiers after a retryable failure and restart", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    const reconcile = vi.fn()
      .mockRejectedValueOnce(new AgentLensError("network_unavailable", "offline", true))
      .mockResolvedValueOnce({ serverTime: "2026-08-20T00:00:00Z", leases: [] });
    const api = apiPort({
      capabilities: vi.fn(async () => capabilities()),
      currentClientVersion: vi.fn(() => "0.1.0"),
      reconcile
    });
    const createAuth = () => new AuthService({
      startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })), revoke: vi.fn()
    }, { async load() { return "refresh-1"; }, async save() {}, async clear() {} });
    let sequence = 0;
    const createWorkbench = () => new AgentLensWorkbenchService(
      createAuth(), api, new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" }),
      state, () => `scheduler-${++sequence}`
    );

    await expect(createWorkbench().runScheduled("periodic_tick")).rejects.toThrow("offline");
    expect((await state.load()).pendingActions).toEqual([expect.objectContaining({ kind: "remote_action" })]);

    await expect(createWorkbench().runScheduled("periodic_tick")).resolves.toMatchObject({ leases: 0, skipped: null });
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile.mock.calls[0]?.slice(1)).toEqual(reconcile.mock.calls[1]?.slice(1));
    expect((await state.load()).pendingActions).toEqual([]);
  });

  it.each([true, false])("records local saves independently of receipt availability (%s)", async (receiptAvailable) => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    const auth = new AuthService({
      startDeviceAuthorization: vi.fn(),
      pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })),
      revoke: vi.fn()
    }, {
      async load() { return "refresh-1"; },
      async save() {},
      async clear() {}
    }, () => 1_000);
    const writeResults = vi.fn(async () => ({ accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 }));
    if (!receiptAvailable) writeResults.mockRejectedValue(new Error("receipt network unavailable"));
    const api = apiPort({
      capabilities: vi.fn(async () => capabilities()),
      currentClientVersion: vi.fn(() => "0.1.0"),
      reconcile: vi.fn(async () => ({
        serverTime: "2026-08-20T00:00:00Z",
        leases: [{ creatorId: "creator-1", leaseId: "lease-1", trigger: "normal" as const, saveFolderPath: "Research/Creator", noteTemplateId: "default" as const, mediaPolicy: "download_all" as const, schedulerState: "due" as const, nextCheckAt: null }]
      })),
      creatorUpdates: vi.fn(async () => ({
        creatorId: "creator-1",
        leaseId: "lease-1",
        fetchRunId: "lease-1",
        fetchId: "fetch-1",
        previews: [{
          platform: "youtube",
          contentId: "new-1",
          canonicalUrl: "https://youtube.com/watch?v=new-1",
          text: "New source",
          publishedAt: "2026-08-20T00:01:00Z",
          author: { id: "creator-1", displayName: "Creator" },
          media: []
        }],
        cursor: null,
        hasMore: false,
        coverageComplete: true,
        truncated: false,
        stopReason: "no_next_page",
        requestId: "request-1"
      })),
      writeResults
    });
    const workbench = new AgentLensWorkbenchService(
      auth,
      api,
      new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" }),
      state,
      () => "generated-1");

    const [result, duplicate] = await Promise.all([
      workbench.runScheduled("periodic_tick"),
      workbench.runScheduled("network_restored")
    ]);

    expect(result).toMatchObject({ leases: 1, pages: 1, saved: 1, failed: 0 });
    expect(duplicate).toEqual(result);
    expect(api.reconcile).toHaveBeenCalledTimes(1);
    expect(api.reconcile).toHaveBeenCalledWith(
      "access-1",
      "periodic_tick",
      "generated-1",
      "scheduler-reconcile-generated-1"
    );
    expect(writeResults).toHaveBeenCalledWith(
      "access-1",
      expect.objectContaining({
        creatorId: "creator-1",
        fetchRunId: "lease-1",
        runComplete: true,
        coverageComplete: true
      }),
      expect.stringContaining("auto-results-lease-1")
    );
    expect((await state.load()).creatorDiagnostics).toMatchObject({
      "creator-1": {
        lastSavedCount: 1,
        lastSavedFetchRunId: "lease-1",
        lastSavedRunSequence: 1,
        countedPages: ["lease-1:fetch-1"]
      }
    });
    const recorded = structuredClone((await state.load()).creatorDiagnostics);
    writeResults.mockResolvedValue({ accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 });
    await workbench.flushPendingCallbacks("access-1");
    expect((await state.load()).creatorDiagnostics).toEqual(recorded);

    // A different source run that only reuses the same physical note cannot
    // replace Last Saved or count it as another newly saved note.
    const oldLease = (await api.reconcile("access-1", "periodic_tick", "r", "k")).leases[0]!;
    const oldPage = await api.creatorUpdates("access-1", oldLease, null, "r", "k");
    vi.mocked(api.reconcile).mockResolvedValue({ serverTime: "2026-08-20T00:02:00Z", leases: [{ ...oldLease, leaseId: "lease-2" }] });
    vi.mocked(api.creatorUpdates).mockResolvedValue({ ...oldPage, leaseId: "lease-2", fetchRunId: "lease-2", fetchId: "fetch-2" });
    await workbench.runScheduled("periodic_tick");
    expect((await state.load()).creatorDiagnostics).toEqual(recorded);

  });

  it("retains automatic write intent if persisting the page receipt fails after the note is saved", async () => {
    let data: unknown = {};
    let failReceipt = true;
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) {
        if (failReceipt && JSON.stringify(value).includes('"kind":"result_callback"')) throw new Error("receipt disk failure");
        data = structuredClone(value);
      }
    }, () => "install-1");
    const auth = new AuthService({
      startDeviceAuthorization: vi.fn(),
      pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })),
      revoke: vi.fn()
    }, {
      async load() { return "refresh-1"; },
      async save() {},
      async clear() {}
    }, () => 1_000);
    const writeResults = vi.fn(async () => ({ accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 }));
    const api = apiPort({
      getExecution: async () => ({ operationId: "lease-1", creatorId: "creator-1", runTrigger: "normal", sourceStatus: "source_succeeded",
        retryAt: null, latestPageNumber: 1, nextPageCursor: null, activePageCursor: null,
        target: { installationId: "install-1", bindingId: "creator-1", targetId: null, folderId: null, folderPath: "Research/Creator" } }),
      capabilities: vi.fn(async () => capabilities()),
      currentClientVersion: vi.fn(() => "0.1.0"),
      reconcile: vi.fn(async () => ({
        serverTime: "2026-08-20T00:00:00Z",
        leases: [{ creatorId: "creator-1", leaseId: "lease-1", trigger: "normal" as const, saveFolderPath: "Research/Creator", noteTemplateId: "default" as const, mediaPolicy: "download_all" as const, schedulerState: "due" as const, nextCheckAt: null }]
      })),
      creatorUpdates: vi.fn(async () => ({
        creatorId: "creator-1",
        leaseId: "lease-1",
        fetchRunId: "lease-1",
        fetchId: "fetch-1",
        previews: [{
          platform: "youtube",
          contentId: "new-1",
          canonicalUrl: "https://youtube.com/watch?v=new-1",
          text: "New source",
          publishedAt: "2026-08-20T00:01:00Z",
          author: { id: "creator-1", displayName: "Creator" },
          media: []
        }],
        cursor: null,
        hasMore: false,
        coverageComplete: true,
        truncated: false,
        stopReason: "no_next_page",
        requestId: "request-1"
      })),
      writeResults
    });
    const workbench = new AgentLensWorkbenchService(
      auth,
      api,
      new VaultWriter(new MemoryVault(), { folderPath: "AgentLens/Inbox" }),
      state,
      () => "generated-1");

    await expect(workbench.runScheduled("periodic_tick")).rejects.toThrow("receipt disk failure");
    expect(writeResults).not.toHaveBeenCalled();
    const pending = (await state.load()).pendingActions;
    expect(pending.filter((action) => action.kind === "write_manifest")).toHaveLength(1);
    expect((await state.load()).ledger["youtube:new-1"]?.status).toBe("written");
    const savedBeforeReceiptRecovery = structuredClone((await state.load()).creatorDiagnostics);
    expect(savedBeforeReceiptRecovery["creator-1"]).toMatchObject({ lastSavedCount: 1, lastSavedFetchRunId: "lease-1" });
    failReceipt = false;
    await expect(workbench.flushPendingWrites("access-1")).resolves.toBe(1);
    expect(writeResults).toHaveBeenCalledTimes(1);
    expect((await state.load()).pendingActions).toEqual([
      expect.objectContaining({ kind: "scheduler_delivery", payload: expect.objectContaining({ page: expect.objectContaining({ fetchId: "fetch-1" }) }) })
    ]);
    // Source pagination has advanced; the independently durable delivery must still settle.
    await workbench.runScheduled("periodic_tick");
    expect((await state.load()).pendingActions).toEqual([]);
    expect((await state.load()).creatorDiagnostics).toEqual(savedBeforeReceiptRecovery);
  });

  it("keeps signed media credentials and download headers out of a failed-write queue", async () => {
    let data: unknown = {};
    const state = new PluginStateStore({
      async loadData() { return structuredClone(data); },
      async saveData(value) { data = structuredClone(value); }
    }, () => "install-1");
    const auth = new AuthService({
      startDeviceAuthorization: vi.fn(),
      pollDeviceAuthorization: vi.fn(),
      refresh: vi.fn(async () => ({ accessToken: "access-1", expiresIn: 3600 })),
      revoke: vi.fn()
    }, {
      async load() { return "refresh-1"; },
      async save() {},
      async clear() {}
    });
    class FailingTextVault extends MemoryVault {
      override async createText(): Promise<VaultFileRef> {
        throw new Error("Vault is temporarily unavailable");
      }
    }
    const api = apiPort({
      capabilities: vi.fn(async () => capabilities()),
      currentClientVersion: vi.fn(() => "0.1.0"),
      reconcile: vi.fn(async () => ({
        serverTime: "2026-08-20T00:00:00Z",
        leases: [{ creatorId: "creator-1", leaseId: "lease-1", trigger: "normal" as const, saveFolderPath: "Research/Creator", noteTemplateId: "default" as const, mediaPolicy: "download_all" as const, schedulerState: "due" as const, nextCheckAt: null }]
      })),
      creatorUpdates: vi.fn(async () => ({
        creatorId: "creator-1",
        leaseId: "lease-1",
        fetchRunId: "lease-1",
        fetchId: "fetch-1",
        previews: [{
          platform: "youtube",
          contentId: "signed-1",
          canonicalUrl: "https://youtube.com/watch?v=signed-1",
          text: "New source",
          author: { id: "creator-1", displayName: "Creator" },
          media: [{
            id: "media-1",
            kind: "video" as const,
            sourceUrl: "https://cdn.example/video.mp4?X-Amz-Signature=source-secret",
            downloadUrlExpiresAt: "2026-08-20T01:00:00Z",
            thumbnailUrl: "https://cdn.example/thumb.jpg?token=thumb-secret",
            thumbnailExpiresAt: "2026-08-20T01:00:00Z",
            coverUrl: "https://cdn.example/cover.jpg?signature=cover-secret",
            downloadHeaders: { Authorization: "Bearer header-secret" }
          }]
        }],
        cursor: null,
        hasMore: false,
        coverageComplete: true,
        truncated: false,
        stopReason: "no_next_page",
        requestId: "request-1"
      })),
      writeResults: vi.fn(async () => ({ accepted: 1, success: 0, partial: 0, failed: 1, skipped: 0 }))
    });
    const vault = new FailingTextVault();
    const workbench = new AgentLensWorkbenchService(
      auth,
      api,
      new VaultWriter(vault, { folderPath: "AgentLens/Inbox" }),
      state,
      () => "generated-1",
      undefined,
      (options) => new VaultWriter(vault, {
        folderPath: options.folderPath ?? "AgentLens/Inbox",
        templateId: options.templateId,
        mediaPolicy: options.mediaPolicy
      })
    );

    await expect(workbench.runScheduled("periodic_tick")).resolves.toMatchObject({ failed: 1 });
    const persisted = JSON.stringify(await state.load());
    expect(persisted).toContain("https://cdn.example/video.mp4");
    expect(persisted).toContain("https://cdn.example/thumb.jpg");
    expect(persisted).not.toMatch(/source-secret|thumb-secret|cover-secret|header-secret|Authorization|X-Amz/i);
  });
});

it.each(["cancel", "sign-out"])("%s stops manual saves without starting later notes or leaving automatic retry intents", async action => {
  let data: unknown = {};
  const state = new PluginStateStore({ loadData: async () => structuredClone(data), saveData: async value => { data = structuredClone(value); } }, () => "install-cancel");
  const vault = new MemoryVault();
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(), revoke: vi.fn() }, { load: async () => null, save: async () => {}, clear: async () => {} });
  const download = vi.fn((_media, signal?: AbortSignal) => new Promise<ArrayBuffer>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })));
  const writer = new VaultWriter(vault, { folderPath: "Inbox" });
  const workbench = new AgentLensWorkbenchService(auth, apiPort(), writer, state, () => crypto.randomUUID(), { download });
  const preview: PreviewResult = { demo: true, usageRemaining: null, post: { platform: "x", contentId: "one", canonicalUrl: "https://x.com/a/status/1", title: "One", text: "One", author: { id: "a", displayName: "A" }, media: [{ id: "v", kind: "video", sourceUrl: "https://cdn.example/v.mp4" }] } };
  const prepared = [];
  for (let index = 0; index < 12; index++) {
    const item = { ...preview, post: { ...preview.post, contentId: String(index), title: `Note ${index}` } };
    prepared.push({ preview: item, manifest: await writer.plan(item.post) });
  }
  const pending = workbench.savePrepared(prepared);
  try {
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect([...vault.files.keys()].filter(path => path.endsWith(".md"))).toHaveLength(8));
  } finally {
    if (action === "sign-out") await workbench.signOut();
    else workbench.cancelManualSaves();
  }
  const result = await pending;
  expect(result.successes).toHaveLength(8);
  expect(result.successes.every(row => row.write.ledger.completion === "partial")).toBe(true);
  expect(result.failures).toHaveLength(4);
  expect(result.failures.every(row => row.error === "Save cancelled.")).toBe(true);
  expect([...vault.files.keys()].filter(path => path.endsWith(".md"))).toHaveLength(8);
  expect((await state.load()).pendingActions).toEqual([]);
  expect(workbench.isManualSaving()).toBe(false);
});

it.each([0, 5])("verifies a physical indexed write after %i earlier failures without a new write attempt", async (earlierFailures) => {
  const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
  const { OperationStore } = await import("@/auto-fetch/operation-store");
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.useFakeTimers({ toFake: ["Date"] });
  const at = "2026-10-19T00:00:00.000Z";
  vi.setSystemTime(new Date(at));
  try {
    const scope = { userId: capabilities().accountId, installationId: "install", creatorId: "creator" };
    const creator = { creatorId: "creator", followId: "follow", configRevision: 1, saveFolderPath: "Research",
      noteTemplateId: "default", mediaPolicy: "link_only", autoFetchEnabled: false, frequency: { every: 1, unit: "hour" } } as CreatorRecord;
    const operations = new OperationStore("physical-recovery");
    await operations.admit(scope, undefined, { observedThrough: at, configRevision: 1 }, [{ operationId: "run",
      admissionKey: "run", configRevision: 1, trigger: "normal", snapshot: creator, coverage: [], queuedAt: at,
      status: "queued", version: 0, attempts: 0 }]);
    let data: unknown = {};
    const state = new PluginStateStore({ async loadData() { return data; }, async saveData(value) { data = structuredClone(value); } }, () => "install");
    const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn(),
      refresh: async () => ({ accessToken: "token", expiresIn: 3600 }) },
      { async load() { return "refresh"; }, async save() {}, async clear() {} });
    const writeResults = vi.fn(async (_token: string, input: import("@/api/AgentLensApiClient").WriteResultsRequest) => ({
      accepted: input.results.length, success: input.results.filter(item => item.status === "success").length,
      failed: input.results.filter(item => item.status === "failed").length,
      skipped: input.results.filter(item => item.status === "skipped").length,
      partial: input.results.filter(item => item.status === "partial").length }));
    const creatorUpdates = vi.fn(async () => ({ creatorId: "creator", fetchRunId: "run", leaseId: "run", fetchId: "page", requestId: "request", serverCheckedAt: at,
      previews: [{ platform: "youtube", contentId: "post", canonicalUrl: "https://example.com/post", text: "Post",
        author: { id: "creator", displayName: "Creator" }, media: [] }], hasMore: false, cursor: null, coverageComplete: true, truncated: false, stopReason: "done" }));
    const api = apiPort({ capabilities: async () => capabilities(), listCreators: async () => [creator],
      settings: async () => ({ homeTimezone: "UTC", confirmed: true }), creatorUpdates, writeResults });
    const vault = new MemoryVault();
    if (earlierFailures) {
      const response = await creatorUpdates();
      await operations.transition(scope, "run", 0, { status: "running", attemptKey: "source-attempt", attempts: 1,
        executionStartedAt: at, dispatchedAt: at });
      await operations.acceptPage(scope, "run", 1, response, at);
      for (let attempt = 0; attempt < earlierFailures; attempt++) {
        await operations.beginPage(scope, "run", 1, attempt, Date.parse(at) - (earlierFailures - attempt) * 300_000);
        await operations.failPage(scope, "run", 1, attempt + 1, false);
      }
    }
    const writer = new VaultWriter(vault, { folderPath: "Research" });
    const execute = vi.spyOn(writer, "execute");
    const workbench = new AgentLensWorkbenchService(auth, api, writer, state,
      () => crypto.randomUUID(), undefined, undefined, undefined, operations);
    vi.spyOn(operations, "commitWrite").mockRejectedValueOnce(new Error("receipt disk unavailable"));
    expect(await workbench.runScheduled("service_start")).toMatchObject({ failed: 1 });
    expect(vault.files.size).toBe(1);
    expect(await operations.creatorStatistics(scope)).toBeUndefined();
    vi.setSystemTime(new Date(Date.parse(at) + 300_000));
    await workbench.runScheduled("periodic_tick");
    expect(vault.files.size).toBe(1);
    expect(creatorUpdates).toHaveBeenCalledTimes(1);
    expect(await operations.creatorStatistics(scope)).toMatchObject({ importedCount: 1, lastSavedCount: 1, lastSavedAt: at });
    expect((await workbench.autoFetchSetup()).creators[0]).toMatchObject({ lastSavedCount: 1, lastSavedFetchRunId: "run",
      lastSuccessfulCheckAt: at, nextCheckAt: null, localStatus: { runState: "source_succeeded" } });
    const projected = await workbench.refreshAutoFetchCreators([{ ...creator, autoFetchEnabled: true, scheduleAnchorAt: at,
      nextCheckAt: "2026-10-19T00:02:00Z" }]);
    expect(projected[0]?.nextCheckAt).toBe("2026-10-19T01:00:00.000Z");
    await workbench.flushPendingCallbacks();
    expect(writeResults.mock.calls.some(([, body]) => body.writeAttemptId === `run:page:${earlierFailures + 1}`
      && body.results.some(item => item.status === "success"))).toBe(true);
    expect(await operations.creatorStatistics(scope)).toMatchObject({ importedCount: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await workbench.autoFetchTaskHistory("creator", "Research")).items).toMatchObject([{ operationId: "run", sourceStatus: "source_succeeded" }]);
    expect(await workbench.autoFetchTaskDetail("creator", "Research", "run")).toMatchObject({ statistics: { savedCount: 1 } });
    expect(await workbench.autoFetchTaskDetail("creator", "Other", "run")).toBeUndefined();
    const sourceCalls = creatorUpdates.mock.calls.length, callbackCalls = writeResults.mock.calls.length;
    const diagnostics = await workbench.exportLocalDiagnostics();
    expect(diagnostics.queues.find(row => row.status === "source_succeeded")).toMatchObject({
      items: [{ operationId: "run", statistics: { savedCount: 1 } }],
    });
    expect(creatorUpdates).toHaveBeenCalledTimes(sourceCalls);
    expect(writeResults).toHaveBeenCalledTimes(callbackCalls);
    const savedHistory = await operations.taskHistory(scope, "Research");
    let release!: () => void;
    vi.spyOn(operations, "taskHistory").mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(savedHistory); }));
    const delayed = workbench.autoFetchTaskHistory("creator", "Research");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await auth.signOut();
    release();
    await expect(delayed).rejects.toThrow("account changed");
    await expect(workbench.autoFetchTaskDetail("creator", "Research", "run")).rejects.toThrow("account changed");
    await expect(workbench.exportLocalDiagnostics()).rejects.toThrow("account changed");
  } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
});

it("settles an old failed page from another task's physical completion without downloading again", async () => {
  const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
  const { OperationStore } = await import("@/auto-fetch/operation-store");
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const at = "2026-10-19T00:00:00.000Z", repairedAt = "2026-10-19T00:05:00.000Z";
  const scope = { userId: capabilities().accountId, installationId: "install", creatorId: "creator" };
  const creator = { creatorId: "creator", followId: "follow", configRevision: 1, saveFolderPath: "Research",
    noteTemplateId: "default", mediaPolicy: "download_all", autoFetchEnabled: false, frequency: { every: 1, unit: "hour" } } as CreatorRecord;
  const store = new OperationStore("reuse-completion");
  await store.admit(scope, undefined, { observedThrough: at, configRevision: 1 }, ["old", "repair"].map(operationId => ({
    operationId, admissionKey: operationId, configRevision: 1, trigger: "normal", snapshot: creator, coverage: [],
    queuedAt: at, status: "queued", version: 0, attempts: 0 })));
  const post = { platform: "youtube", contentId: "post", canonicalUrl: "https://example.com/post", title: "Post", text: "Text",
    author: { id: "creator", displayName: "Creator" }, media: [{ id: "image", kind: "image" as const, sourceUrl: "https://cdn.example/image.png" }] };
  for (const run of ["old", "repair"]) await store.transition(scope, run, 0, { status: "running", attemptKey: run,
    attempts: 1, executionStartedAt: at, dispatchedAt: at });
  await store.acceptPage(scope, "old", 1, { creatorId: "creator", fetchRunId: "old", leaseId: "old", fetchId: "page",
    requestId: "request", previews: [post], hasMore: false, cursor: null, coverageComplete: true, truncated: false, stopReason: "done" }, at);
  await store.transition(scope, "repair", 1, { status: "source_succeeded", completedAt: repairedAt });
  const vault = new MemoryVault();
  let now = at;
  const writer = new VaultWriter(vault, { folderPath: "Research", mediaPolicy: "download_all", now: () => new Date(now) });
  const original = await writer.plan(post);
  const originalIntent = await store.prepareWrite(scope, "old", original);
  const failed = await writer.execute(original, post.canonicalUrl, async () => { throw new Error("HTTP 410 expired"); }, { recoveryId: originalIntent.recoveryId });
  const request = (run: string) => ({ creatorId: "creator", fetchRunId: run, runId: run, fetchId: "page",
    writeAttemptId: `${run}:page:1`, runComplete: false, coverageComplete: true, truncated: false, results: [] });
  await store.commitWrite(scope, failed, request("old"), true);
  await store.beginPage(scope, "old", 1, 0, Date.parse(at));
  await store.failPage(scope, "old", 1, 1, true);
  now = repairedAt;
  const repairManifest = await writer.plan(post, { targetNotePath: failed.ledger.notePath });
  const repairIntent = await store.prepareWrite(scope, "repair", repairManifest);
  const repaired = await writer.execute(repairManifest, post.canonicalUrl, async () => new ArrayBuffer(3), { recoveryId: repairIntent.recoveryId });
  await store.commitWrite(scope, repaired, request("repair"), true);
  let data: unknown = {};
  const state = new PluginStateStore({ loadData: async () => data, saveData: async value => { data = structuredClone(value); } }, () => "install");
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn(),
    refresh: async () => ({ accessToken: "token", expiresIn: 3600 }) },
    { load: async () => "refresh", save: async () => {}, clear: async () => {} });
  const source = vi.fn(), download = vi.fn(), execute = vi.spyOn(writer, "execute");
  const api = apiPort({ capabilities: async () => capabilities(), listCreators: async () => [creator], creatorUpdates: source,
    writeResults: async (_token, body) => ({ accepted: body.results.length, success: body.results.filter(item => item.status === "success").length,
      partial: body.results.filter(item => item.status === "partial").length, failed: 0,
      skipped: body.results.filter(item => item.status === "skipped").length }) });
  const commit = vi.spyOn(store, "commitWrite");
  const workbench = new AgentLensWorkbenchService(auth, api, writer, state, () => crypto.randomUUID(), { download }, undefined, undefined, store);
  await workbench.runScheduled("service_start");
  expect(await store.pendingPages(scope, 8, Date.now(), "needs_refetch")).toEqual([]);
  expect(await store.runStatistics(scope, "old")).toMatchObject({ savedCount: 1, savedAt: at });
  expect(await store.creatorStatistics(scope)).toMatchObject({ importedCount: 2, lastSavedFetchRunId: "repair", lastSavedAt: repairedAt });
  const oldReceipt = await store.writeReceipt(scope, "old", original.contentKey, original.notePath);
  expect(oldReceipt?.ledger.completion).toBe("complete");
  expect(commit).toHaveBeenCalledWith(scope, expect.objectContaining({ recovered: true }),
    expect.objectContaining({ fetchRunId: "old", writeAttemptId: "old:page:1:reuse" }), false);
  await workbench.runScheduled("periodic_tick");
  expect(source).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  const history = await workbench.importTasks();
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({id: "indexed:install:old", phase: "saved", time: at});
  expect(history[0]!.notes).toHaveLength(1);
  expect(history[0]!.notes[0]!.preview.indexedWrite?.scope).toEqual(scope);
  expect(history[0]!.notes[0]!.manifest.contentKey).toBe(original.contentKey);
});

it("allows independent downloads from separate service windows sharing the same Vault", async () => {
  let data: unknown = {};
  const state = new PluginStateStore({ loadData: async () => data, saveData: async value => { data = structuredClone(value); } }, () => "shared-vault");
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(), revoke: vi.fn() },
    { load: async () => null, save: async () => {}, clear: async () => {} });
  const vault = new MemoryVault(), writer = new VaultWriter(vault, { folderPath: "Inbox" });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const firstDownload = vi.fn(async () => { await gate; return new ArrayBuffer(2); });
  const secondDownload = vi.fn(async () => new ArrayBuffer(2));
  const first = new AgentLensWorkbenchService(auth, apiPort(), writer, state, () => crypto.randomUUID(), { download: firstDownload });
  const second = new AgentLensWorkbenchService(auth, apiPort(), writer, state, () => crypto.randomUUID(), { download: secondDownload });
  const preview: PreviewResult = { demo: true, usageRemaining: null, post: { platform: "x", contentId: "one", canonicalUrl: "https://x.com/a/status/1",
    title: "One", text: "One", author: { id: "a", displayName: "A" }, media: [{ id: "image", kind: "image", sourceUrl: "https://cdn.example/image.png" }] } };
  const next = { ...preview, post: { ...preview.post, contentId: "two", title: "Two" } };
  const planned = [{ preview, manifest: await writer.plan(preview.post) }, { preview: next, manifest: await writer.plan(next.post) }];
  const running = first.savePrepared([planned[0]!]);
  await vi.waitFor(() => expect(firstDownload).toHaveBeenCalledTimes(1));
  const queued = second.savePrepared([planned[1]!]);
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    await vi.waitFor(() => expect(secondDownload).toHaveBeenCalledTimes(1));
  } finally { release(); }
  expect((await running).failures).toEqual([]); expect((await queued).failures).toEqual([]);
  expect(secondDownload).toHaveBeenCalledTimes(1);
});

it.each([false, true, "verify", "note", "account"] as const)("recovers mixed media without repeating uncertain publication (uncertain: %s)", async uncertain => {
  const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
  const { OperationStore } = await import("@/auto-fetch/operation-store");
  const { MediaDownloadError } = await import("@/core/mediaFailure");
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  vi.useFakeTimers({ toFake: ["Date"] });
  const at = "2026-10-19T00:00:00.000Z"; vi.setSystemTime(new Date(at));
  try {
    const scope = { userId: capabilities().accountId, installationId: "install", creatorId: "creator" };
    const creator = { creatorId: "creator", followId: "follow", configRevision: 1, saveFolderPath: "Research",
      noteTemplateId: "default", mediaPolicy: "download_all", autoFetchEnabled: false, frequency: { every: 1, unit: "hour" } } as CreatorRecord;
    const store = new OperationStore("mixed-media-service");
    await store.admit(scope, undefined, { observedThrough: at, configRevision: 1 }, [{ operationId: "run", admissionKey: "run",
      configRevision: 1, trigger: "normal", snapshot: creator, coverage: [], queuedAt: at, status: "queued", version: 0, attempts: 0 }]);
    await store.transition(scope, "run", 0, { status: "running", attemptKey: "source", executionStartedAt: at, dispatchedAt: at });
    const post = { platform: "youtube", contentId: "post", canonicalUrl: "https://example.com/post", title: "Post", text: "Text",
      author: { id: "creator", displayName: "Creator" }, media: ["saved", "expired", "temporary"].map(id => ({ id, kind: "image" as const, sourceUrl: `https://cdn.example/${id}.png` })) };
    await store.acceptPage(scope, "run", 1, { creatorId: "creator", fetchRunId: "run", leaseId: "run", fetchId: "page", requestId: "request",
      previews: [post], hasMore: false, cursor: null, coverageComplete: true, truncated: false, stopReason: "done" }, at);
    let data: unknown = {};
    const state = new PluginStateStore({ loadData: async () => data, saveData: async value => { data = structuredClone(value); } }, () => "install");
    const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn(),
      refresh: async () => ({ accessToken: "token", expiresIn: 3600 }) }, { load: async () => "refresh", save: async () => {}, clear: async () => {} });
    const vault = new MemoryVault();
    const writer = new VaultWriter(vault, { folderPath: "Research", mediaPolicy: "download_all" });
    if (uncertain === "note") {
      const publish = vault.createText.bind(vault);
      vi.spyOn(vault, "createText").mockImplementation(async (path, text) => { await publish(path, text); throw new Error("Note acknowledgement lost"); });
    } else if (uncertain && uncertain !== "account") {
      const publish = vault.createBinary.bind(vault);
      vi.spyOn(vault, "createBinary").mockImplementation(async (path, bytes) => { await publish(path, bytes); throw new Error("Watcher acknowledgement lost"); });
      if (uncertain === "verify") Object.assign(vault, { fingerprintMedia: async (path: string) => {
        const bytes = vault.binaryFiles.get(path);
        return bytes ? (await import("@/vault/MediaFingerprint")).fingerprintBytes(bytes) : undefined;
      } });
    }
    let temporaryCalls = 0;
    const download = vi.fn(async (media: { id: string }) => {
      if (uncertain === "account") { await auth.signOut(); return new ArrayBuffer(1); }
      if (media.id === "expired") throw MediaDownloadError.http(403);
      if (media.id === "temporary" && ++temporaryCalls === 1) throw new Error("timeout");
      return new ArrayBuffer(1);
    });
    const source = vi.fn(), refresh = vi.fn();
    const api = apiPort({ capabilities: async () => capabilities(), listCreators: async () => [creator], creatorUpdates: source, refreshMedia: refresh,
      writeResults: async (_token, body) => ({ accepted: body.results.length, success: body.results.filter(item => item.status === "success").length,
        partial: body.results.filter(item => item.status === "partial").length, failed: 0, skipped: body.results.filter(item => item.status === "skipped").length }) });
    const service = () => new AgentLensWorkbenchService(auth, api, writer, state, () => crypto.randomUUID(),
      { download, refreshOnFailure: false }, undefined, undefined, new OperationStore("mixed-media-service"));
    if (uncertain === "account") await expect(service().runScheduled("service_start")).rejects.toThrow("account session changed");
    else await service().runScheduled("service_start");
    if (uncertain === "account") {
      expect(vault.files.size).toBe(1);
      expect(vault.binaryFiles.size).toBe(0);
      expect(download).toHaveBeenCalledTimes(1);
      expect(await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toHaveLength(1);
      expect(await store.creatorStatistics(scope)).toBeUndefined();
      expect(await store.dueCallbacks(scope, Date.now())).toEqual([]);
      expect(source).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
      return;
    }
    if (uncertain === "note") {
      expect(await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toHaveLength(1);
      expect(await store.creatorStatistics(scope)).toBeUndefined();
      vi.setSystemTime(new Date(Date.parse(at) + 300000));
      await service().runScheduled("service_start");
      expect(await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown")).toEqual([]);
      expect(await store.creatorStatistics(scope)).toMatchObject({ importedCount: 1 });
      expect(await store.pendingDeliveries(scope)).toHaveLength(1);
      expect(download).not.toHaveBeenCalled();
      const intent = await store.writeIntent(scope, "run", "youtube:post");
      expect(intent).toMatchObject({ notePrepared: false, completed: true });
      vi.setSystemTime(new Date(Date.parse(at) + 300000));
      await service().runScheduled("service_start");
      expect(download.mock.calls.map(([media]) => media.id)).toEqual(["saved", "expired", "temporary"]);
      expect(vault.createText).toHaveBeenCalledTimes(1);
      expect(await store.creatorStatistics(scope)).toMatchObject({ importedCount: 1 });
      expect(source).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
      return;
    }
    if (uncertain) {
      expect((await store.pendingDeliveries(scope, 8, Number.MAX_SAFE_INTEGER, "write_unknown"))[0]?.mediaFailures)
        .toEqual([{ mediaId: "saved", kind: "write_unknown" }]);
      const intent = await new OperationStore("mixed-media-service").writeIntent(scope, "run", "youtube:post");
      expect(intent?.mediaPublications?.saved).toMatchObject({ mediaId: "saved", sizeBytes: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(await store.creatorStatistics(scope)).toBeUndefined();
      expect(await store.dueCallbacks(scope, Date.now())).toEqual([]);
      vi.setSystemTime(new Date(Date.parse(at) + 300000));
      if (uncertain === "verify") {
        const note = [...vault.files.keys()].find(path => path.endsWith(".md"))!;
        vault.files.set(note, vault.files.get(note)! + "\nUser-owned research note\n");
      }
      await service().runScheduled("service_start");
      expect(download.mock.calls.map(([media]) => media.id)).toEqual(["saved"]);
      if (uncertain === "verify") {
        expect(await store.pendingDeliveries(scope, 8, Date.now(), "write_unknown")).toEqual([]);
        expect(await store.pendingDeliveries(scope)).toHaveLength(1);
        expect(await store.runStatistics(scope, "run")).toMatchObject({ savedCount: 1 });
        expect([...vault.files.values()].some(text => text.includes("User-owned research note"))).toBe(true);
        vi.restoreAllMocks();
        await service().runScheduled("periodic_tick");
        vi.setSystemTime(new Date(Date.parse(at) + 600000));
        await service().runScheduled("periodic_tick");
        expect(download.mock.calls.map(([media]) => media.id)).toEqual(["saved", "expired", "temporary", "temporary"]);
        expect(await store.pendingDeliveries(scope, 8, Date.now(), "needs_refetch")).toHaveLength(1);
        expect(await store.runStatistics(scope, "run")).toMatchObject({ savedCount: 1 });
        expect(source).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
        return;
      }
      expect(await store.pendingDeliveries(scope, 8, Date.now(), "write_unknown")).toHaveLength(1);
      expect(vault.files.size).toBe(2);
      expect(source).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
      return;
    }
    expect(download.mock.calls.map(([media]) => media.id)).toEqual(["saved", "expired", "temporary"]);
    expect(await store.pendingDeliveries(scope)).toHaveLength(1);
    vi.setSystemTime(new Date(Date.parse(at) + 300000));
    await service().runScheduled("service_start");
    expect(download.mock.calls.map(([media]) => media.id)).toEqual(["saved", "expired", "temporary", "temporary"]);
    expect(await store.pendingDeliveries(scope)).toEqual([]);
    expect(await store.pendingDeliveries(scope, 8, Date.now(), "needs_refetch")).toHaveLength(1);
    expect(await store.runStatistics(scope, "run")).toMatchObject({ savedCount: 1 });
    expect(source).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it.each([[true, true], [true, false], [false, true], [false, false]])("honors WRITE-003 host policy (refresh enabled: %s, already expired: %s)", async (refreshOnFailure, expired) => {
  const { MediaDownloadError } = await import("@/core/mediaFailure");
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn(),
    refresh: async () => ({ accessToken: "token", expiresIn: 3600 }) },
    { load: async () => "refresh", save: async () => {}, clear: async () => {} });
  const refreshMedia = vi.fn(async () => []);
  const api = apiPort({ refreshMedia, writeResults: async () => ({ accepted: 1, success: 0, partial: 1, failed: 0, skipped: 0 }) });
  let data: unknown = {};
  const state = new PluginStateStore({ loadData: async () => data, saveData: async value => { data = structuredClone(value); } }, () => "install");
  const writer = new VaultWriter(new MemoryVault(), { folderPath: "Research", mediaPolicy: "download_all" });
  const download = vi.fn(async () => { throw MediaDownloadError.http(403); });
  const workbench = new AgentLensWorkbenchService(auth, api, writer, state, () => crypto.randomUUID(), { download, refreshOnFailure });
  const preview: PreviewResult = { demo: false, fetchId: "fetch", monitoringInstanceId: "creator", post: {
    platform: "youtube", contentId: "post", canonicalUrl: "https://example.com/post", text: "Post",
    author: { id: "author", displayName: "Author" }, media: [{ id: "image", kind: "image", sourceUrl: "https://cdn.example/image",
      ...(expired ? { downloadUrlExpiresAt: "2000-01-01T00:00:00Z" } : {}) }],
  } };
  await workbench.restoreAuth();
  await workbench.savePrepared([{ preview, manifest: await writer.plan(preview.post) }]);
  expect(download).toHaveBeenCalledTimes(!refreshOnFailure && expired ? 0 : 1);
  expect(refreshMedia).toHaveBeenCalledTimes(refreshOnFailure ? 1 : 0);
});

it("exports diagnostics from confirmed account information without opening Auto-Fetch or making export requests", async () => {
  const { IDBFactory, IDBKeyRange } = await import("fake-indexeddb");
  const { OperationStore } = await import("@/auto-fetch/operation-store");
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn(),
    refresh: async () => ({ accessToken: "token", expiresIn: 3600 }) },
    { async load() { return "refresh"; }, async save() {}, async clear() {} });
  const account = vi.fn(async () => ({ user: { id: "diagnostic-user", email: "private@example.com", name: "User" },
    installationId: "install", subscription: {} } as import("@/api/AgentLensApiClient").AccountSummary));
  const state = new PluginStateStore({ async loadData() { return {}; }, async saveData() {} }, () => "install");
  const workbench = new AgentLensWorkbenchService(auth, apiPort({ account }), new VaultWriter(new MemoryVault(), { folderPath: "Research" }),
    state, () => crypto.randomUUID(), undefined, undefined, undefined, new OperationStore("account-diagnostics"));
  await workbench.account();
  const data = await workbench.exportLocalDiagnostics();
  expect(data.scope).toMatchObject({ userId: "diagnostic-user", installationId: "install" });
  expect(JSON.stringify(data)).not.toContain("private@example.com");
  expect(account).toHaveBeenCalledOnce();
  await auth.signOut();
  await expect(workbench.exportLocalDiagnostics()).rejects.toThrow("account changed");
});

describe("Auto Fetch task execution", () => {
  function taskFixture(download: (media: any, signal?: AbortSignal, progress?: (value: any) => void) => Promise<ArrayBuffer>, secondFile = false) {
    let data: unknown = {};
    let sequence = 0;
    const state = new PluginStateStore({ async loadData() { return structuredClone(data); }, async saveData(value) { data = structuredClone(value); } }, () => "install-1");
    const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn(),
      refresh: async () => ({ accessToken: "access", expiresIn: 3600 }) }, { async load() { return "refresh"; }, async save() {}, async clear() {} });
    const vault = new MemoryVault();
    const createText = vi.spyOn(vault, "createText");
    const createBinary = vi.spyOn(vault, "createBinary");
    const lease = { creatorId: "creator", leaseId: "run", trigger: "normal" as const, saveFolderPath: "Inbox", noteTemplateId: "default" as const, mediaPolicy: "download_all" as const, schedulerState: "due" as const, nextCheckAt: null };
    const api = apiPort({ capabilities: async () => capabilities(), currentClientVersion: () => "0.2.1",
      reconcile: vi.fn().mockResolvedValueOnce({ serverTime: "now", leases: [lease] }).mockResolvedValue({ serverTime: "now", leases: [] }),
      creatorUpdates: vi.fn(async () => ({ creatorId: "creator", leaseId: "run", fetchRunId: "run", fetchId: "fetch", requestId: "request", cursor: null, hasMore: false, coverageComplete: true, truncated: false, stopReason: "no_next_page",
        previews: [{ platform: "youtube", contentId: "one", canonicalUrl: "https://youtube.com/watch?v=one", text: "A note", author: { id: "creator", displayName: "Creator" },
          media: [{ id: "file", kind: "image" as const, sourceUrl: "https://cdn.example/file.jpg" }, ...(secondFile ? [{ id: "second", kind: "image" as const, sourceUrl: "https://cdn.example/second.jpg" }] : [])] }] })),
      writeResults: vi.fn(async () => ({ accepted: 1, success: 1, partial: 0, failed: 0, skipped: 0 })) });
    const service = new AgentLensWorkbenchService(auth, api, new VaultWriter(vault, { folderPath: "Inbox" }), state, () => `id-${++sequence}`, { refreshOnFailure: false, download });
    return { service, state, api, vault, createText, createBinary };
  }

  it("retries only failed local attachments without refetching or creating another note", async () => {
    const download = vi.fn().mockRejectedValueOnce(new Error("Download failed")).mockResolvedValue(new ArrayBuffer(4));
    const { service, api, createText, createBinary } = taskFixture(download);
    await service.runScheduled("service_start");
    const task = (await service.importTasks())[0]!;
    expect(task.phase).toBe("failed");
    expect(task.notes[0]?.files[0]?.phase).toBe("failed");
    await service.retryImportTask(task.id);
    expect((await service.importTasks())[0]?.phase).toBe("saved");
    expect(api.creatorUpdates).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledTimes(2);
    expect(createText).toHaveBeenCalledOnce();
    expect(createBinary).toHaveBeenCalledOnce();
  });

  it("rejects Retry on a successful task without refetching or rewriting its files", async () => {
    const download = vi.fn(async () => new ArrayBuffer(4));
    const { service, api, createText, createBinary } = taskFixture(download);
    await service.runScheduled("service_start");
    const task = (await service.importTasks())[0]!;
    expect(task.phase).toBe("saved");
    await expect(service.retryImportTask(task.id)).rejects.toThrow("This task has no failed files to retry.");
    expect(api.creatorUpdates).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    expect(createText).toHaveBeenCalledOnce();
    expect(createBinary).toHaveBeenCalledOnce();
    expect((await service.importTasks())[0]?.phase).toBe("saved");
  });

  it("reports each saved attachment before the remaining attachments finish", async () => {
    let started!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const download = vi.fn(async (media, _signal, progress) => {
      progress?.({ receivedBytes: 2, totalBytes: 4 });
      if (media.id === "second") { started(); await wait; }
      return new ArrayBuffer(4);
    });
    const { service } = taskFixture(download, true);
    const running = service.runScheduled("service_start");
    await ready;
    const files = (await service.importTasks())[0]!.notes[0]!.files;
    await vi.waitFor(async () => expect((await service.importTasks())[0]!.notes[0]!.files[0]?.phase).toBe("saved"));
    expect(files[1]).toMatchObject({ phase: "downloading", receivedBytes: 2, totalBytes: 4 });
    release(); await running;
    expect((await service.importTasks())[0]?.phase).toBe("saved");
  });

  it("cancels the current download and does not resume it on the next automatic tick", async () => {
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const download = vi.fn(async (_media, signal?: AbortSignal) => {
      started();
      await new Promise<void>(resolve => signal?.addEventListener("abort", () => resolve(), { once: true }));
      signal?.throwIfAborted();
      return new ArrayBuffer(0);
    });
    const { service, api, createText } = taskFixture(download);
    const running = service.runScheduled("service_start");
    const rejected = expect(running).rejects.toBeDefined();
    await ready;
    const task = (await service.importTasks())[0]!;
    await service.cancelImportTask(task.id);
    await rejected;
    expect((await service.importTasks())[0]?.phase).toBe("cancelled");
    expect(createText).toHaveBeenCalledOnce();
    await service.runScheduled("periodic_tick");
    expect(api.creatorUpdates).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
  });

});

it("loads native setup after catalog failure but retains the scheduling configuration gate", async () => {
  const registerDestination=vi.fn().mockRejectedValue(new AgentLensError("provider_unavailable","catalog",true,500));
  const pendingDestinations=vi.fn();const adoptDestination=vi.fn();
  const followChanges=vi.fn().mockRejectedValue(Error("configuration unavailable"));
  const f=service({registerDestination,pendingDestinations,adoptDestination,followChanges,
    capabilities:async()=>capabilities(), settings:async()=>({homeTimezone:"UTC",confirmed:true}),listCreators:async()=>[]},true,
    async()=>({targetId:"vault",healthy:true,writable:true,name:"Research",folders:[{id:"vault:🏊",path:"🏊"}]}));
  await expect(f.workbench.autoFetchSetup()).resolves.toMatchObject({creators:[],settings:{confirmed:true}});
  await expect(f.workbench.runScheduled("service_start")).rejects.toThrow("configuration unavailable");
  expect(followChanges).toHaveBeenCalledOnce();
  expect(registerDestination).toHaveBeenCalledTimes(2);
  expect(pendingDestinations).not.toHaveBeenCalled();
  expect(adoptDestination).not.toHaveBeenCalled();
});

describe("read-only historical lists", () => {
  function setup(overrides: Partial<AgentLensApiPort> = {}, download = vi.fn(async () => { throw new Error("expired media"); })) {
    const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), revoke: vi.fn(),
      refresh: async () => ({ accessToken: "token", expiresIn: 3600 }) },
      { load: async () => "refresh", save: async () => {}, clear: async () => {} });
    const state = new PluginStateStore({ loadData: async () => ({}), saveData: async () => {} });
    const vault = new MemoryVault();
    const api = apiPort(overrides);
    const service = new AgentLensWorkbenchService(auth, api, new VaultWriter(vault, { folderPath: "History" }), state,
      () => crypto.randomUUID(), { download, refreshOnFailure: true });
    return { service, auth, api, vault, download };
  }
  it("does not start fetch or supplementation when history is unavailable", async () => {
    const fetch = vi.fn(), supplementContent = vi.fn();
    const { service } = setup({ restoreHistory: vi.fn(async () => { throw new Error("not found"); }), fetch, supplementContent });
    await expect(service.restoreHistory("original-fetch")).rejects.toThrow("not found");
    expect(fetch).not.toHaveBeenCalled(); expect(supplementContent).not.toHaveBeenCalled();
  });
  it("discards a restore response after the account changes", async () => {
    let release!: (page: import("@/api/AgentLensApiClient").FetchPage) => void;
    const restoreHistory = vi.fn(() => new Promise<import("@/api/AgentLensApiClient").FetchPage>(resolve => { release = resolve; }));
    const { service, auth } = setup({ restoreHistory });
    await auth.restore();
    const pending = service.restoreHistory("original-fetch");
    await vi.waitFor(() => expect(restoreHistory).toHaveBeenCalled());
    await auth.signOut();
    release({ ...demoPage(), mode: "profile_page", fetchId: "original-fetch" });
    await expect(pending).rejects.toThrow("account or destination changed");
  });
  it("blocks incomplete historical posts without requesting details", async () => {
    const supplementContent = vi.fn();
    const { service } = setup({ supplementContent });
    await expect(service.supplementContent({ post: { ...demoPage().content[0]!, needSupplement: true },
      fetchId: "original-fetch", demo: false, historyRestore: true })).rejects.toThrow("never requests new details");
    expect(supplementContent).not.toHaveBeenCalled();
  });
  it("never refreshes an expired historical media URL even on a downloader that permits refresh", async () => {
    const refreshMedia = vi.fn();
    const writeResults = vi.fn(async () => ({ accepted: 1, success: 0, partial: 1, failed: 0, skipped: 0 }));
    const { service, download } = setup({ refreshMedia, writeResults });
    const preview: PreviewResult = { historyRestore: true, fetchId: "original-fetch", demo: false,
      post: { ...demoPage().content[0]!, needSupplement: false, media: [{ id: "original-image", kind: "image", sourceUrl: "https://example.com/image.jpg" }] } };
    const manifest = await service.planPreview(preview, { folderPath: "History", mediaPolicy: "download_all" });
    await service.savePrepared([{ preview, manifest }]);
    expect(download).toHaveBeenCalled(); expect(refreshMedia).not.toHaveBeenCalled();
  });
});

it("propagates single-save cancellation and byte progress to the downloader", async () => {
  let data: unknown = {};
  const state = new PluginStateStore({ loadData: async () => structuredClone(data), saveData: async value => { data = structuredClone(value); } }, () => "install-cancel");
  const vault = new MemoryVault();
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(), revoke: vi.fn() }, { load: async () => null, save: async () => {}, clear: async () => {} });
  const download = vi.fn((media: { id: string }, signal?: AbortSignal, progress?: (value: {receivedBytes: number; totalBytes?: number}) => void) => {
    if (media.id === "first") {
      progress?.({ receivedBytes: 2, totalBytes: 2 });
      return Promise.resolve(new Uint8Array([1, 2]).buffer);
    }
    progress?.({ receivedBytes: 128, totalBytes: 1024 });
    return new Promise<ArrayBuffer>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const writer = new VaultWriter(vault, { folderPath: "Inbox" });
  const workbench = new AgentLensWorkbenchService(auth, apiPort(), writer, state, () => crypto.randomUUID(), { download });
  const preview: PreviewResult = { demo: true, usageRemaining: null, post: { platform: "x", contentId: "one", canonicalUrl: "https://x.com/a/status/1", title: "One", text: "One", author: { id: "a", displayName: "A" }, media: [{ id: "first", kind: "image", sourceUrl: "https://cdn.example/first.jpg" }, { id: "v", kind: "video", sourceUrl: "https://cdn.example/v.mp4" }] } };
  const next = { ...preview, post: { ...preview.post, contentId: "two", title: "Two" } };
  const controller = new AbortController();
  const transfer = vi.fn();
  const pending = workbench.savePrepared([{ preview, manifest: await writer.plan(preview.post) }, { preview: next, manifest: await writer.plan(next.post) }], undefined, { signal: controller.signal, onTransfer: transfer });
  await vi.waitFor(() => expect(download.mock.calls.filter(([media]) => media.id === "v")).toHaveLength(2));
  expect(transfer).toHaveBeenCalledWith({ contentKey: "x:one", attachmentIndex: 1, attachmentCount: 2, receivedBytes: 2, totalBytes: 2, downloadedCount: 0, downloading: true });
  expect(transfer).toHaveBeenCalledWith({ contentKey: "x:one", attachmentIndex: 1, attachmentCount: 2, receivedBytes: 2, totalBytes: 2, downloadedCount: 1, downloading: false });
  expect(transfer).toHaveBeenCalledWith({ contentKey: "x:one", attachmentIndex: 2, attachmentCount: 2, receivedBytes: 128, totalBytes: 1024, downloadedCount: 1, downloading: true });
  controller.abort();
  const result = await pending;
  expect(result.successes).toHaveLength(2);
  expect(result.successes[0]?.write.ledger.completion).toBe("partial");
  expect(result.failures).toEqual([]);
  expect([...vault.files.keys()].filter(path => path.endsWith(".md"))).toHaveLength(2);
  expect((await state.load()).pendingActions).toEqual([]);
  expect(workbench.isManualSaving()).toBe(false);
});

it("reproduces the reported 2GiB slow download queue and releases it on close cancellation", async () => {
  const { createServer } = await import("node:http");
  const { DesktopMediaDownloader } = await import("../src/vault/DesktopMediaDownloader");
  const server = createServer((_req,res)=>{res.writeHead(200,{"Content-Type":"video/mp4","Content-Length":2133015830});res.write(new Uint8Array(1024).fill(42));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}/video`;
  let data: unknown={};const state=new PluginStateStore({loadData:async()=>data,saveData:async v=>{data=structuredClone(v);}},()=>"spacex-repro");
  const auth=new AuthService({startDeviceAuthorization:vi.fn(),pollDeviceAuthorization:vi.fn(),refresh:vi.fn(),revoke:vi.fn()},{load:async()=>null,save:async()=>{},clear:async()=>{}});
  const vault=new MemoryVault(),writer=new VaultWriter(vault,{folderPath:'Repro'});
  const dl=new DesktopMediaDownloader(undefined,3000,2000,async()=>"DIRECT");
  let bytes=0;
  const service=new AgentLensWorkbenchService(auth,apiPort(),writer,state,()=>crypto.randomUUID(),dl);
  const post={platform:'x' as const,contentId:'video',canonicalUrl:'https://x.com/SpaceX/status/1',title:'Large video',text:'QA',author:{id:'SpaceX',displayName:'SpaceX'},media:[{id:'8db4c6d1e93a4102d3c4241ad81658baa5c54b7a1319c4c446b99a22e4d092b7',kind:'video' as const,sourceUrl:url,sizeBytes:2133015830}]};
  const video={demo:true,post}; const text={demo:true,post:{...post,contentId:'text',title:'Text after reopening',media:[]}};
  const videoPlan=await writer.plan(post),textPlan=await writer.plan(text.post);
  const first=service.savePrepared([{preview:video,manifest:videoPlan}],undefined,{onTransfer:p=>{bytes=p.receivedBytes;}});
  let second: ReturnType<typeof service.savePrepared> | undefined;
  try {
    await vi.waitFor(()=>expect(bytes).toBe(1024));
    expect(vault.getFile(videoPlan.notePath)).toBeTruthy();
    second=service.savePrepared([{preview:text,manifest:textPlan}]);
    await new Promise(r=>setTimeout(r,80));
    expect(Boolean(vault.getFile(textPlan.notePath))).toBe(true);
    service.cancelManualSaves();
    await first;await second;
    expect(service.isManualSaving()).toBe(false);
    const fresh={demo:true,post:{...text.post,contentId:'fresh',title:'Text after actual close cancellation'}};
    const result=await service.savePrepared([{preview:fresh,manifest:await writer.plan(fresh.post)}]);
    expect(result.failures).toEqual([]);expect(result.successes).toHaveLength(1);
  } finally {service.cancelManualSaves();await first;await second;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

it("keeps another active attachment visible when a concurrent download completes", async()=>{
  let data:unknown={};const state=new PluginStateStore({loadData:async()=>data,saveData:async v=>{data=structuredClone(v);}},()=>"parallel-progress");
  const auth=new AuthService({startDeviceAuthorization:vi.fn(),pollDeviceAuthorization:vi.fn(),refresh:vi.fn(),revoke:vi.fn()},{load:async()=>null,save:async()=>{},clear:async()=>{}});
  const vault=new MemoryVault(),writer=new VaultWriter(vault,{folderPath:'Progress'});
  const releases=new Map<string,()=>void>();
  const download=vi.fn(async(media: import('@/core/domain').NormalizedMedia,_signal?:AbortSignal,progress?: (p:{receivedBytes:number;totalBytes?:number})=>void)=>{progress?.({receivedBytes:1,totalBytes:2});await new Promise<void>(r=>releases.set(media.id,r));return new ArrayBuffer(2);});
  const svc=new AgentLensWorkbenchService(auth,apiPort(),writer,state,()=>crypto.randomUUID(),{download});
  const post={platform:'x' as const,contentId:'progress',canonicalUrl:'https://example.com/progress',text:'QA',author:{id:'qa',displayName:'QA'},media:['one','two'].map(id=>({id,kind:'image' as const,sourceUrl:`https://cdn.example/${id}.jpg`}))};
  const progress=vi.fn();const pending=svc.savePrepared([{preview:{post,demo:true},manifest:await writer.plan(post)}],undefined,{onTransfer:progress});
  try {await vi.waitFor(()=>expect(releases.size).toBe(2));releases.get('one')!();await vi.waitFor(()=>expect(progress).toHaveBeenCalledWith(expect.objectContaining({downloadedCount:1,downloading:true,attachmentIndex:2})));}
  finally {for(const release of releases.values())release();await pending;}
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({downloadedCount:2,downloading:false}));
});

it("does not reparse or refresh after the mobile 403 recovery has been consumed", async () => {
  const state = new PluginStateStore({ loadData: async () => ({}), saveData: async () => {} }, () => "recovery-install");
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(async () => ({ accessToken: "access", expiresIn: 3600 })), revoke: vi.fn() },
    { load: async () => "refresh", save: async () => {}, clear: async () => {} });
  await auth.restore();
  const refreshMedia = vi.fn();
  const api = apiPort({ refreshMedia, writeResults: vi.fn() });
  const vault = new MemoryVault();
  const download = vi.fn(async () => { throw new MediaRecoveryError(MediaDownloadError.http(403)); });
  const workbench = new AgentLensWorkbenchService(auth, api, new VaultWriter(vault, { folderPath: "Inbox" }), state, () => crypto.randomUUID(), { streaming: false, download });
  const preview = { demo: false, fetchId: "original-fetch", post: { platform: "tiktok", contentId: "original-post", canonicalUrl: "https://www.tiktok.com/@katyperry/video/1", text: "Original",
    author: { id: "katyperry", displayName: "Katy Perry" }, media: [{ id: "original-media", kind: "video" as const, sourceUrl: "https://www.tiktok.com/aweme/v1/play/" }] } };
  const result = await workbench.save(preview, await workbench.planPreview(preview));
  expect(result.write.attachments).toEqual([expect.objectContaining({ status: "failed" })]);
  expect(download).toHaveBeenCalledTimes(1); expect(refreshMedia).not.toHaveBeenCalled();
});
