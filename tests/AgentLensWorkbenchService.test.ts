import { describe, expect, it, vi } from "vitest";
import { AgentLensWorkbenchService, DEMO_URL, type PreviewResult } from "@/workbench/AgentLensWorkbenchService";
import type { AgentLensApiPort } from "@/workbench/ports";
import { AuthService, type AuthApi, type RefreshTokenPersistence } from "@/auth/AuthService";
import { PluginStateStore, type PluginDataAdapter } from "@/runtime/PluginStateStore";
import { VaultWriter, type VaultFileRef, type VaultPort } from "@/vault/VaultWriter";
import { userMessage } from "@/core/user-feedback";
import { AgentLensError } from "@/core/errors";
import type { CreatorRecord } from "@/api/AgentLensApiClient";
import type { AccountCapabilities } from "@/api/contracts";

class MemoryVault implements VaultPort {
  files = new Map<string, string>();
  frontmatter = new Map<string, Readonly<Record<string, unknown>>>();
  keysByPath = new Map<string, string>();
  getFile(path: string): VaultFileRef | null { return this.files.has(path) ? { path } : null; }
  async readText(file: VaultFileRef) { return this.files.get(file.path) ?? ""; }
  async createText(path: string, content: string) { this.files.set(path, content); return { path }; }
  async modifyText(file: VaultFileRef, content: string) { this.files.set(file.path, content); }
  async ensureFolder() {}
  async createBinary(path: string) { this.files.set(path, "<binary>"); return { path }; }
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

function service(overrides: Partial<AgentLensApiPort> = {}, signedIn = false) {
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
      () => "id-1"),
    readData: () => data,
    vault,
    api
  };
}

describe("AgentLensWorkbenchService", () => {
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

  it("executes only server-issued scheduler leases and settles note receipts", async () => {
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
        countedPages: ["lease-1:fetch-1"]
      }
    });
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
    failReceipt = false;
    await expect(workbench.flushPendingWrites("access-1")).resolves.toBe(1);
    expect(writeResults).toHaveBeenCalledTimes(1);
    expect((await state.load()).pendingActions).toEqual([
      expect.objectContaining({ kind: "scheduler_checkpoint", payload: expect.objectContaining({ pageNumber: 1 }) })
    ]);
    // Flushing a write receipt does not prove the page was durably advanced.
    // A scheduler pass must replay/verify the original page before retiring it.
    await workbench.runScheduled("periodic_tick");
    expect((await state.load()).pendingActions).toEqual([]);
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

it("cancels manual saves without starting later notes or leaving automatic retry intents", async () => {
  let data: unknown = {};
  const state = new PluginStateStore({ loadData: async () => structuredClone(data), saveData: async value => { data = structuredClone(value); } }, () => "install-cancel");
  const vault = new MemoryVault();
  const auth = new AuthService({ startDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(), refresh: vi.fn(), revoke: vi.fn() }, { load: async () => null, save: async () => {}, clear: async () => {} });
  const download = vi.fn((_media, signal?: AbortSignal) => new Promise<ArrayBuffer>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })));
  const writer = new VaultWriter(vault, { folderPath: "Inbox" });
  const workbench = new AgentLensWorkbenchService(auth, apiPort(), writer, state, () => crypto.randomUUID(), { download });
  const preview: PreviewResult = { demo: true, usageRemaining: null, post: { platform: "x", contentId: "one", canonicalUrl: "https://x.com/a/status/1", title: "One", text: "One", author: { id: "a", displayName: "A" }, media: [{ id: "v", kind: "video", sourceUrl: "https://cdn.example/v.mp4" }] } };
  const next = { ...preview, post: { ...preview.post, contentId: "two", title: "Two" } };
  const pending = workbench.savePrepared([{ preview, manifest: await writer.plan(preview.post) }, { preview: next, manifest: await writer.plan(next.post) }]);
  await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  workbench.cancelManualSaves();
  const result = await pending;
  expect(result.successes).toHaveLength(1);
  expect(result.successes[0]?.write.ledger.completion).toBe("partial");
  expect(result.failures[0]?.error).toBe("Save cancelled.");
  expect([...vault.files.keys()].filter(path => path.endsWith(".md"))).toHaveLength(1);
  expect((await state.load()).pendingActions).toEqual([]);
  expect(workbench.isManualSaving()).toBe(false);
});
