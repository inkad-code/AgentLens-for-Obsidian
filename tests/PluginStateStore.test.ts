import { describe, expect, it } from "vitest";
import { PluginStateStore, type PluginDataAdapter } from "@/runtime/PluginStateStore";

class MemoryAdapter implements PluginDataAdapter {
  data: unknown = { defaultFolderPath: "Notes" };
  async loadData() { return structuredClone(this.data); }
  async saveData(data: unknown) { this.data = structuredClone(data); }
}

describe("PluginStateStore", () => {
  it("preserves unrelated plugin settings and creates a stable installation", async () => {
    const adapter = new MemoryAdapter();
    const store = new PluginStateStore(adapter, () => "install-1");

    expect((await store.load()).installationId).toBe("install-1");
    expect((await store.load()).installationId).toBe("install-1");
    expect(adapter.data).toMatchObject({ defaultFolderPath: "Notes" });
  });

  it("serializes concurrent state updates without losing ledger entries", async () => {
    const adapter = new MemoryAdapter();
    const store = new PluginStateStore(adapter, () => "install-1");
    await store.load();

    await Promise.all(["a", "b"].map((key) => store.update((state) => {
      state.ledger[key] = {
        destination: "obsidian",
        contentKey: key,
        notePath: `${key}.md`,
        sourceUrl: `https://example.com/${key}`,
        writtenAt: "2026-08-19T00:00:00.000Z",
        managedDigest: key,
        contentId: "1",
        effectivePostKey: "youtube:1",
        attachmentPaths: [],
        media: [],
        mediaPolicy: "link_only",
        firstWrittenAt: "2026-08-19T00:00:00.000Z",
        lastVerifiedAt: "2026-08-19T00:00:00.000Z",
        physicalStatus: "active",
        lastActionId: key,
        status: "written",
        completion: "complete"
      };
    })));

    expect(Object.keys((await store.load()).ledger).sort()).toEqual(["a", "b"]);
  });

  it("serializes settings patches with state writes", async () => {
    const adapter = new MemoryAdapter();
    const store = new PluginStateStore(adapter, () => "install-1");
    await store.load();

    await Promise.all([
      store.patchRoot({ agentlensSettings: { defaultFolderPath: "Archive" } }),
      store.update((state) => {
        state.pendingActions.push({
          id: "callback-1",
          kind: "result_callback",
          createdAt: "2026-08-20T00:00:00.000Z",
          payload: { notePath: "Archive/note.md" }
        });
      })
    ]);

    expect(await store.readRoot()).toMatchObject({
      defaultFolderPath: "Notes",
      agentlensSettings: { defaultFolderPath: "Archive" },
      agentlensState: { pendingActions: [{ id: "callback-1" }] }
    });
  });

  it("repairs malformed state without rotating a valid installation identity", async () => {
    const adapter = new MemoryAdapter();
    adapter.data = {
      agentlensState: {
        schemaVersion: 1,
        installationId: "install-existing",
        refreshTokenSecretId: "secret-ref-1",
        ledger: null,
        pendingActions: [{ kind: "result_callback" }]
      }
    };
    const store = new PluginStateStore(adapter, () => "install-new");

    await expect(store.load()).resolves.toMatchObject({
      installationId: "install-existing",
      refreshTokenSecretId: "secret-ref-1",
      ledger: {},
      pendingActions: [],
      creatorDiagnostics: {}
    });
  });

  it("upgrades a valid legacy state that predates Creator diagnostics", async () => {
    const adapter = new MemoryAdapter();
    adapter.data = {
      agentlensState: {
        schemaVersion: 1,
        installationId: "install-legacy",
        ledger: {},
        pendingActions: []
      }
    };
    const store = new PluginStateStore(adapter, () => "install-new");

    await expect(store.load()).resolves.toMatchObject({
      installationId: "install-legacy",
      creatorDiagnostics: {},
      uiPreferences: {}
    });
  });

  it("persists update dismissal and onboarding version as non-secret UI preferences", async () => {
    const adapter = new MemoryAdapter();
    const store = new PluginStateStore(adapter, () => "install-1");
    await store.load();

    await store.patchUiPreferences({ dismissedUpdateVersion: "0.2.0" });
    await store.patchUiPreferences({ onboardingVersion: 1 });

    await expect(store.uiPreferences()).resolves.toEqual({
      dismissedUpdateVersion: "0.2.0",
      onboardingVersion: 1
    });
  });

  it("accumulates distinct saved pages in one Creator run without double counting a replay", async () => {
    const adapter = new MemoryAdapter();
    const store = new PluginStateStore(adapter, () => "install-1");
    await store.load();

    await store.recordCreatorSavedPage("creator-1", "run-1", "fetch-1", 2, "2026-09-04T01:00:00Z");
    await store.recordCreatorSavedPage("creator-1", "run-1", "fetch-1", 2, "2026-09-04T01:01:00Z");
    await store.recordCreatorSavedPage("creator-1", "run-1", "fetch-2", 3, "2026-09-04T01:02:00Z");

    expect((await store.load()).creatorDiagnostics).toEqual({
      "creator-1": {
        lastSavedAt: "2026-09-04T01:02:00Z",
        lastSavedCount: 5,
        lastSavedFetchRunId: "run-1",
        countedPages: ["run-1:fetch-1", "run-1:fetch-2"]
      }
    });
  });

  it("counts separately recovered posts on one page once across restart", async () => {
    const adapter = new MemoryAdapter();
    const store = new PluginStateStore(adapter, () => "install-1");
    await store.recordCreatorSavedPage("creator", "run", "page", 1, "2026-09-12T00:00:00Z", ["x:a"]);
    const restarted = new PluginStateStore(adapter, () => "unused");
    await restarted.recordCreatorSavedPage("creator", "run", "page", 1, "2026-09-12T00:01:00Z", ["x:b"]);
    await restarted.recordCreatorSavedPage("creator", "run", "page", 2, "2026-09-12T00:02:00Z", ["x:a", "x:b"]);
    expect((await restarted.load()).creatorDiagnostics.creator).toMatchObject({ lastSavedCount: 2, lastSavedAt: "2026-09-12T00:01:00Z" });
  });

  it("merges local save metrics into server-owned Creator state", async () => {
    const adapter = new MemoryAdapter();
    const store = new PluginStateStore(adapter, () => "install-1");
    await store.load();
    await store.recordCreatorSavedPage("creator-1", "run-1", "fetch-1", 2, "2026-09-04T01:00:00Z");

    const [creator] = await store.mergeCreatorDiagnostics([{
      creatorId: "creator-1",
      importedCount: 8
    }]);
    expect(creator).toMatchObject({
      creatorId: "creator-1",
      importedCount: 8,
      lastSavedAt: "2026-09-04T01:00:00Z",
      lastSavedCount: 2,
      lastSavedFetchRunId: "run-1"
    });
  });

  it("publishes isolated state snapshots and stops after unsubscribe", async () => {
    const adapter = new MemoryAdapter();
    const store = new PluginStateStore(adapter, () => "install-1");
    const observed: Array<{ installationId: string; pendingActions: number }> = [];
    const unsubscribe = store.subscribe((state) => {
      observed.push({
        installationId: state.installationId,
        pendingActions: state.pendingActions.length
      });
      state.pendingActions.push({
        id: "listener-mutation",
        kind: "result_callback",
        createdAt: "2026-08-20T00:00:00.000Z",
        payload: {}
      });
    });

    const loaded = await store.load();
    expect(loaded.pendingActions).toEqual([]);

    const updated = await store.update((state) => {
      state.pendingActions.push({
        id: "real-action",
        kind: "result_callback",
        createdAt: "2026-08-20T00:00:00.000Z",
        payload: {}
      });
    });
    expect(updated.pendingActions.map((action) => action.id)).toEqual(["real-action"]);
    expect(observed).toEqual([
      { installationId: "install-1", pendingActions: 0 },
      { installationId: "install-1", pendingActions: 1 }
    ]);

    unsubscribe();
    await store.update((state) => { state.pendingActions = []; });
    expect(observed).toHaveLength(2);
    expect((await store.load()).pendingActions).toEqual([]);
  });
});

it("remembers the selected folder across store recreation without losing other preferences", async () => {
  const adapter = new MemoryAdapter();
  const store = new PluginStateStore(adapter, () => "install-1");
  await store.patchUiPreferences({ onboardingVersion: 1 });
  await store.patchUiPreferences({ recentFolder: "Research/Articles" });
  expect(await new PluginStateStore(adapter, () => "install-2").uiPreferences()).toMatchObject({ recentFolder: "Research/Articles", onboardingVersion: 1 });
});
