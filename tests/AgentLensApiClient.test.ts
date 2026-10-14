import { describe, expect, it, vi } from "vitest";
import { AgentLensApiClient } from "@/api/AgentLensApiClient";
import type { JsonTransport, TransportRequest } from "@/runtime/ObsidianRequestUrlTransport";

class FakeTransport implements JsonTransport {
  readonly requests: TransportRequest[] = [];
  constructor(private readonly responses: unknown[]) {}
  async json<T>(request: TransportRequest, validate: (value: unknown) => T): Promise<T> {
    this.requests.push(request);
    return validate(this.responses.shift());
  }
}

const IDENTITY = {
  installationId: "install-1",
  deviceId: "device-1",
  clientVersion: "0.1.0",
  obsidianVersion: "1.13.7",
  platform: "desktop_macos" as const
};

describe("AgentLensApiClient", () => {
  it("reads demo endpoints without authentication or installation headers", async () => {
    const response = { success: true, data: { fetchId: "demo", mode: "profile_page", platform: "x",
      creator: { creatorId: "spacex", displayName: "SpaceX" }, content: [],
      page: { cursor: null, hasMore: false, pageNumber: 2 }, usage: { charged: false, units: 0, remaining: null } } };
    const transport = new FakeTransport([response, response]);
    const api = new AgentLensApiClient(transport, IDENTITY);
    await api.demoFetch("single_post");
    await api.demoFetch("profile_page", "snapshot-id");
    expect(transport.requests.map(request => request.path)).toEqual([
      "/v1/plugins/demo/single", "/v1/plugins/demo/profile?cursor=snapshot-id"
    ]);
    for (const request of transport.requests) {
      expect(request.accessToken).toBeUndefined();
      expect(request.installationId).toBeUndefined();
      expect(request.method).toBe("GET");
    }
  });

  it("maps Google cancellation to a terminal denied result", async () => {
    const transport = new FakeTransport([{success: true, data: {status: "access_denied"}}]);
    await expect(new AgentLensApiClient(transport, IDENTITY).pollDeviceAuthorization("poll-secret"))
      .resolves.toEqual({status: "denied"});
  });

  it("retains the server-issued direct Google URL", async () => {
    const googleAuthorizationUrl = "https://agentlens.example/api/auth/oauth/google/start?pluginTicket=ticket";
    const transport = new FakeTransport([{success: true, data: {
      deviceCode: "poll-secret", userCode: "ABCD-EFGH", verificationUri: "https://agentlens.example/device",
      googleAuthorizationUrl, expiresIn: 600, interval: 3
    }}]);
    await expect(new AgentLensApiClient(transport, IDENTITY).startDeviceAuthorization())
      .resolves.toMatchObject({googleAuthorizationUrl});
  });

  it("normalizes provider markup in titles before any platform workflow uses them", async () => {
    const transport = new FakeTransport([{ success: true, data: {
      fetchId: "fetch-reddit", mode: "single_post", platform: "reddit",
      creator: { creatorId: "creator-1", displayName: "Creator" },
      content: [{ contentId: "post-1", source: { sourceUrl: "https://reddit.com/r/topic/post-1" },
        text: { title: "&lt;p&gt;A &amp; B&lt;/p&gt;", caption: "Description" }, media: [] }],
      page: null, usage: { charged: true, units: 1, remaining: 10 }
    } }]);
    const page = await new AgentLensApiClient(transport, IDENTITY).fetch("access",
      { url: "https://reddit.com/r/topic/post-1", mode: "single_post" }, "idem", "request");
    expect(page.content[0]).toMatchObject({ platform: "reddit", title: "A & B", text: "Description" });
  });

  it("also normalizes titles returned for automatic creator updates", async () => {
    const transport = new FakeTransport([{ success: true, data: {
      creatorId: "creator-1", fetchRunId: "run-1", fetchId: "fetch-1",
      content: [{ contentId: "post-1", source: { platform: "linkedin", sourceUrl: "https://linkedin.com/post-1" },
        text: { title: "&#60;p&#62;A &amp; B&#60;/p&#62;", caption: "Description" }, media: [] }],
      page: null
    } }]);
    const page = await new AgentLensApiClient(transport, IDENTITY)
      .manualCreatorUpdates("access", "creator-1", "request", "idem");
    expect(page.previews[0]).toMatchObject({ platform: "linkedin", title: "A & B", text: "Description" });
  });

  it("uses the username in a Snapchat link when the provider omits the creator name", async () => {
    const transport = new FakeTransport([{ success: true, data: {
      fetchId: "fetch-snap", mode: "single_post", platform: "snapchat",
      creator: { creatorId: "snapchat:unknown", displayName: "snapchat:unknown" },
      content: [{ contentId: "snap-1", source: { sourceUrl: "https://www.snapchat.com/spotlight/snap-1" },
        text: { caption: "Spotlight caption" }, media: [] }],
      page: null, usage: { charged: true, units: 1, remaining: 10 }
    } }]);
    const client = new AgentLensApiClient(transport, IDENTITY);
    const page = await client.fetch("access", { url: "https://www.snapchat.com/@lovegoalsshow/spotlight/snap-1", mode: "single_post" }, "idem", "request");
    expect(page.content[0]?.author).toMatchObject({ id: "snapchat:unknown", displayName: "lovegoalsshow", handle: "lovegoalsshow" });
  });
  it("continues the original creator run through the shared dispatch endpoint", async () => {
    const transport = new FakeTransport([{ success: true, data: { creatorId: "creator/1", fetchRunId: "run-1", fetchId: "fetch-2", content: [],
      page: { cursor: "page-3", hasMore: true, coverageComplete: false, truncated: false, requestId: "request-2" } } }]);
    const client = new AgentLensApiClient(transport, IDENTITY);
    const result = await client.creatorUpdates("access", { creatorId: "creator/1", leaseId: "run-1", trigger: "normal", saveFolderPath: "Research",
      noteTemplateId: "default", mediaPolicy: "link_only", schedulerState: "due", nextCheckAt: null }, "page-2", "request-2", "original-key");
    expect(result).toMatchObject({ fetchRunId: "run-1", cursor: "page-3", hasMore: true });
    expect(transport.requests[0]).toMatchObject({ path: "/v1/plugins/creators/creator%2F1/updates?fetchRunId=run-1&trigger=normal&cursor=page-2",
      accessToken: "access", installationId: "install-1", requestId: "request-2", idempotencyKey: "original-key" });
  });

  const execution = { operationId: "run/1", creatorId: "creator/1", runTrigger: "normal", sourceStatus: "retry_pending",
    retryAt: "2026-09-21T10:00:00Z", latestPageNumber: 10, nextPageCursor: "cursor-11", activePageCursor: null,
    target: { installationId: "install-1", bindingId: "creator/1", targetId: null, folderId: null, folderPath: "Research" } };

  it("reads shared execution evidence without dispatching a fetch", async () => {
    const transport = new FakeTransport([{ success: true, data: execution }]);
    const client = new AgentLensApiClient(transport, IDENTITY);
    expect(await client.getExecution("access", "run/1")).toEqual(execution);
    expect(transport.requests).toEqual([{ path: "/v1/plugins/executions/run%2F1", method: "GET", accessToken: "access", installationId: "install-1" }]);
  });

  it.each([
    { ...execution, operationId: "other" },
    { ...execution, target: { ...execution.target, installationId: "other" } },
    { ...execution, target: { ...execution.target, bindingId: "other" } },
    { ...execution, latestPageNumber: 1.5 },
    { ...execution, retryAt: "2026-09-21T10:00:00" },
    { ...execution, retryAt: "invalid" },
    { ...execution, nextPageCursor: 10 }
  ])("rejects unsafe execution evidence %#", async (data) => {
    const client = new AgentLensApiClient(new FakeTransport([{ success: true, data }]), IDENTITY);
    await expect(client.getExecution("access", "run/1")).rejects.toThrow();
  });

  it("inspects and resumes the original operation with the exact configuration revision", async () => {
    const recovery = { operationId: "run/1", creatorId: "creator/1", configRevision: 12, disposition: "not_started" };
    const transport = new FakeTransport([{ success: true, data: recovery }, { success: true, data: recovery }]);
    const client = new AgentLensApiClient(transport, IDENTITY);
    expect(await client.inspectExecutionRecovery("access", "creator/1", "run/1")).toEqual(recovery);
    expect(await client.resumeUnstartedExecution("access", "creator/1", "run/1", 12)).toEqual(recovery);
    expect(transport.requests).toEqual([
      { path: "/v1/plugins/creators/creator%2F1/execution-recovery?operationId=run%2F1", method: "GET", accessToken: "access", installationId: "install-1" },
      { path: "/v1/plugins/creators/creator%2F1/execution-recovery", method: "POST", accessToken: "access", installationId: "install-1", body: { operationId: "run/1", configRevision: 12 } }
    ]);
    expect(() => client.resumeUnstartedExecution("access", "creator/1", "run/1", -1)).toThrow("configRevision");
    expect(transport.requests).toHaveLength(2);
  });

  it.each([
    { operationId: "other", creatorId: "creator", configRevision: 1, disposition: "not_started" },
    { operationId: "run", creatorId: "other", configRevision: 1, disposition: "not_started" },
    { operationId: "run", creatorId: "creator", configRevision: 1, disposition: "new_unknown_disposition" },
    { operationId: "run", creatorId: "creator", configRevision: 0.5, disposition: "not_started" }
  ])("rejects unsafe recovery evidence %#", async (data) => {
    const client = new AgentLensApiClient(new FakeTransport([{ success: true, data }]), IDENTITY);
    await expect(client.inspectExecutionRecovery("access", "creator", "run")).rejects.toThrow();
  });

  it("reads shared scheduling grants and rejects malformed frequency limits", async () => {
    const capabilities = { minuteFrequencyAvailable: false, minuteFrequencyMaxEvery: 59, minuteCreatorLimit: 10, minuteCreatorUsed: 2 };
    const transport = new FakeTransport([{ success: true, data: capabilities },
      { success: true, data: { ...capabilities, minuteFrequencyMaxEvery: 1.5 } }]);
    const client = new AgentLensApiClient(transport, IDENTITY);
    expect(await client.autoFetchCapabilities("access")).toEqual(capabilities);
    expect(transport.requests[0]).toMatchObject({ path: "/v1/plugins/settings/auto-fetch-capabilities", installationId: "install-1" });
    await expect(client.autoFetchCapabilities("access")).rejects.toThrow("minuteFrequencyMaxEvery is invalid");
  });
  it("uses the web auth response envelope only for device approval", async()=>{
    const transport=new FakeTransport([{token:"web-session"},{success:true,data:{approved:true}}]);
    const client=new AgentLensApiClient(transport,IDENTITY);
    const token=await client.authenticateEmail({email:"user@example.com",password:"test-password"});
    await client.approveDevice(token,"USER-CODE");
    expect(transport.requests).toEqual([{path:"/auth/login",method:"POST",body:{email:"user@example.com",password:"test-password"}},{path:"/v1/auth/device/approve",method:"POST",accessToken:"web-session",body:{userCode:"USER-CODE"}}]);
  });

  it("preserves optional creator identity metadata from the parse response", async () => {
    const transport = new FakeTransport([{success:true,data:{creator:{creatorId:"creator-1",platform:"instagram",profileUrl:"https://instagram.com/studio_mori",displayName:"Studio Mori",handle:"studio_mori",avatarUrl:"https://example.com/avatar.png"},creatorToken:"fixture-token",creatorTokenExpiresAt:"2026-09-12T12:00:00Z"}}]);
    const client = new AgentLensApiClient(transport, IDENTITY);
    const result = await client.parseCreator("fixture-access", "https://instagram.com/studio_mori", "fixture-key");
    expect(result.creator).toMatchObject({handle:"studio_mori",avatarUrl:"https://example.com/avatar.png"});
    expect(transport.requests[0]).toMatchObject({path:"/v1/plugins/creators/parse",idempotencyKey:"fixture-key"});
  });

  it("starts Device Code auth with an explicit Obsidian client identity", async () => {
    const transport = new FakeTransport([{ success: true, data: {
      deviceCode: "device-secret",
      userCode: "ABCD-EFGH",
      verificationUri: "https://agentlensapi.io/device",
      expiresIn: 600,
      interval: 3
    }}]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.startDeviceAuthorization()).resolves.toMatchObject({ userCode: "ABCD-EFGH" });
    expect(transport.requests[0]).toMatchObject({
      path: "/v1/auth/device/start",
      body: {
        clientType: "obsidian_plugin",
        installationId: "install-1",
        deviceId: "device-1",
        obsidianVersion: "1.13.7",
        platform: "desktop_macos"
      }
    });
  });

  it("maps a shared fetch response into host-neutral normalized posts", async () => {
    const transport = new FakeTransport([{ success: true, data: {
      fetchId: "fetch-1",
      mode: "single_post",
      platform: "youtube",
      creator: { creatorId: "youtube:researcher", displayName: "Researcher", handle: "researcher" },
      content: [{
        contentId: "video-42",
        source: { sourceUrl: "https://youtube.com/watch?v=video-42", publishedAt: "2026-08-20T00:00:00Z" },
        text: { title: "Source title", summary: "Summary" },
        media: []
      }],
      media: [],
      page: null,
      usage: { charged: true, units: 1, remaining: 41 }
    }}]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    const result = await client.fetch("access-secret", {
      url: "https://youtube.com/watch?v=video-42",
      mode: "single_post"
    }, "idem-1", "request-1");

    expect(result.content[0]).toMatchObject({
      platform: "youtube",
      contentId: "video-42",
      title: "Source title",
      text: "Summary",
      author: { displayName: "Researcher" }
    });
    expect(transport.requests[0]).toMatchObject({
      path: "/v1/plugins/fetch",
      installationId: "install-1",
      idempotencyKey: "idem-1",
      requestId: "request-1"
    });
  });

  it("rotates a refresh token before revoking the installation", async () => {
    const transport = new FakeTransport([
      { success: true, data: { accessToken: "access-2", refreshToken: "refresh-2", accessTokenExpiresAt: "2026-08-20T01:00:00Z" } },
      { success: true, data: { revoked: true } }
    ]);
    const client = new AgentLensApiClient(transport, IDENTITY, () => Date.parse("2026-08-20T00:00:00Z"));

    await client.revoke("refresh-1");
    expect(transport.requests[1]).toMatchObject({
      path: "/v1/auth/logout",
      accessToken: "access-2",
      installationId: "install-1"
    });
  });

  it("accepts a completed manual check after the server clears its active job", async () => {
    const transport = new FakeTransport([
      { success: true, data: {
        creatorId: "creator-1", fetchRunId: "manual-run-1", fetchId: "fetch-1", content: [],
        page: { cursor: null, hasMore: false, coverageComplete: true, truncated: false, stopReason: "no_next_page", requestId: "request-1" },
        activeJobId: null, lastRequestId: "request-1"
      }},
      { success: true, data: {
        creatorId: "creator-1", deletedAt: "2026-08-20T00:00:00Z",
        futureSchedulingStopped: true, activeJobOutcome: "none"
      }}
    ]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.manualCreatorUpdates("access", "creator-1", "request-1", "manual-1"))
      .resolves.toMatchObject({ leaseId: "manual-run-1", hasMore: false });
    await expect(client.deleteCreator("access", "creator-1", "delete-1"))
      .resolves.toMatchObject({ creatorId: "creator-1", futureSchedulingStopped: true });
    expect(transport.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/v1/obsidian/creators/creator-1/manual-check", method: "POST", idempotencyKey: "manual-1" }),
      expect.objectContaining({ path: "/v1/plugins/creators/creator-1", method: "DELETE", idempotencyKey: "delete-1" })
    ]));
  });

  it("reconciles only through an explicit active executor request with durable identifiers", async () => {
    const transport = new FakeTransport([
      { success: true, data: { serverTime: "2026-08-20T00:00:00Z", leases: [] } },
      { success: true, data: {
        serverTime: "2026-08-20T00:00:01Z", installationId: "install-1", status: "active",
        clientVersion: "0.1.0", obsidianVersion: "1.13.7", lastSeenAt: "2026-08-20T00:00:01Z"
      } },
      { success: true, data: {
        serverTime: "2026-08-20T00:00:02Z", installationId: "install-1", status: "active",
        clientVersion: "0.1.0", obsidianVersion: "1.13.7", lastSeenAt: "2026-08-20T00:00:01Z"
      } }
    ]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.reconcile("access", "network_restored", "request-1", "reconcile-1"))
      .resolves.toMatchObject({ leases: [] });
    await expect(client.heartbeat("access")).resolves.toMatchObject({ installationId: "install-1" });
    await expect(client.schedulerHealth("access")).resolves.toMatchObject({ status: "active" });

    expect(transport.requests[0]).toMatchObject({
      path: "/v1/obsidian/scheduler/reconcile",
      method: "POST",
      requestId: "request-1",
      idempotencyKey: "reconcile-1",
      installationId: "install-1",
      body: {
        reason: "network_restored",
        hostState: "active",
        vaultState: "available",
        networkState: "online",
        clientVersion: "0.1.0"
      }
    });
    expect(transport.requests[1]).toMatchObject({
      path: "/v1/obsidian/scheduler/heartbeat",
      body: { hostState: "active", vaultState: "available", networkState: "online", clientVersion: "0.1.0" }
    });
    expect(transport.requests[2]).toMatchObject({ path: "/v1/obsidian/scheduler/health", method: "GET" });
  });

  it("uses an explicit idempotent endpoint for one-time baseline import", async () => {
    const transport = new FakeTransport([{ success: true, data: {
      fetchId: "baseline-fetch-1", mode: "profile_page", platform: "youtube",
      creator: { creatorId: "creator-1", displayName: "Researcher" }, content: [],
      page: { cursor: null, hasMore: false, pageNumber: 1 },
      usage: { charged: true, units: 1, remaining: 9 }
    }}]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.baselineImport("access", "creator-1", "request-1", "baseline-1"))
      .resolves.toMatchObject({ fetchId: "baseline-fetch-1", mode: "profile_page" });
    expect(transport.requests[0]).toMatchObject({
      path: "/v1/obsidian/creators/creator-1/baseline-import",
      method: "POST",
      requestId: "request-1",
      idempotencyKey: "baseline-1"
    });
  });

  it("refuses Activity continuation without its original query boundary", async () => {
    const transport = new FakeTransport([]);
    const client = new AgentLensApiClient(transport, IDENTITY);
    await expect(client.activity("access", {}, "cursor"))
      .rejects.toThrow("original through boundary");
    expect(transport.requests).toHaveLength(0);
  });

  it("uses read-only Activity list, detail and JSON export contracts", async () => {
    const summary = {
      activityId: "activity-1", operation: "auto_fetch", platform: "youtube",
      targetAlias: "Researcher", occurredAt: "2026-08-20T00:00:00Z", result: "partial",
      chargedUnits: 1, relativeNotePath: "AgentLens/Inbox/", fileCount: 2, deleted: true,
      absolutePath: "/Users/example/private-note.md", accessToken: "must-be-stripped"
    };
    const diagnostics = {
      requestId: "request-1", fetchId: "fetch-1", runId: "run-1", cursorRef: "abc123def456",
      pageNumber: 2, trigger: "catch_up", chargedUnits: 1, reusedExisting: true,
      errorCode: "VAULT_WRITE_INCOMPLETE", errorSummary: "1 of 2 note writes was incomplete.",
      noteBody: "private note body", cookie: "must-be-stripped"
    };
    const transport = new FakeTransport([
      { success: true, data: { items: [{ ...summary, extensions: { obsidian: summary } }], through: "2026-08-21T00:00:00Z", nextCursor: "opaque", pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z" } },
      { success: true, data: { summary: { ...summary, extensions: { obsidian: summary } }, diagnostics } },
      { schema: "plugin-activity-v1", through: "2026-08-21T00:00:00Z", generatedAt: "2026-08-20T00:01:00Z", retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z", truncated: false, items: [{ summary: { ...summary, extensions: { obsidian: summary } }, diagnostics }], refreshToken: "must-be-stripped" }
    ]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.activity("access", { operation: "auto_fetch", result: "partial" }, "cursor-1", 25, "2026-08-21T00:00:00Z"))
      .resolves.toMatchObject({ items: [{ deleted: true }], nextCursor: "opaque" });
    await expect(client.activityDetail("access", "activity-1"))
      .resolves.toMatchObject({ diagnostics: { cursorRef: "abc123def456", reusedExisting: true } });
    const exported = await client.exportActivity("access", { operation: "auto_fetch" });
    expect(exported).toMatchObject({ schema: "obsidian-activity-v1", truncated: false });
    expect(JSON.stringify(exported)).not.toMatch(/must-be-stripped|\/Users\/example|private note body/i);

    expect(transport.requests).toEqual([
      expect.objectContaining({ path: expect.stringContaining("/v1/plugins/activity?operation=auto_fetch&result=partial&cursor=cursor-1&pageSize=25&through=2026-08-21T00%3A00%3A00Z"), method: "GET" }),
      expect.objectContaining({ path: "/v1/plugins/activity/activity-1", method: "GET" }),
      expect.objectContaining({ path: "/v1/plugins/activity/export?operation=auto_fetch", method: "GET" })
    ]);
    expect(transport.requests.every((request) => request.body === undefined && request.idempotencyKey === undefined)).toBe(true);
  });

  it("accepts Creator lifecycle Activity operations", async () => {
    const transport = new FakeTransport([{ success: true, data: {
      items: [{
        activityId: "activity-pause", operation: "creator_pause", platform: "youtube",
        targetAlias: "Researcher", occurredAt: "2026-09-04T00:00:00Z", result: "success",
        chargedUnits: 0, extensions: { obsidian: { relativeNotePath: null, fileCount: 0, deleted: false } }
      }],
      through: "2026-09-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-06-07T00:00:00Z"
    }}]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.activity("access", { operation: "creator_pause" }))
      .resolves.toMatchObject({ items: [{ operation: "creator_pause", chargedUnits: 0 }] });
  });

  it("fails closed when Activity exposes a non-relative Vault path", async () => {
    const transport = new FakeTransport([{
      success: true,
      data: {
        items: [{
          activityId: "activity-unsafe", operation: "single_fetch", platform: "youtube",
          targetAlias: "Public source", occurredAt: "2026-08-20T00:00:00Z", result: "success",
          chargedUnits: 1, extensions: { obsidian: { relativeNotePath: "/Users/example/private-note.md", fileCount: 1, deleted: false } }
        }],
        through: "2026-09-21T00:00:00Z", nextCursor: null, pageSize: 25, retentionDays: 90, retainedFrom: "2026-05-22T00:00:00Z"
      }
    }]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.activity("access")).rejects.toThrow("Vault-relative POSIX path");
  });

  it("fails closed when Activity diagnostics contain credential-bearing material", async () => {
    const summary = {
      activityId: "activity-unsafe", operation: "single_fetch", platform: "youtube",
      targetAlias: "Public source", occurredAt: "2026-08-20T00:00:00Z", result: "failed",
      chargedUnits: 0, relativeNotePath: null, fileCount: 0, deleted: false
    };
    const transport = new FakeTransport([{
      success: true,
      data: {
        summary: { ...summary, extensions: { obsidian: summary } },
        diagnostics: {
          requestId: "request-1", fetchId: null, runId: null, cursorRef: null,
          pageNumber: null, trigger: null, chargedUnits: 0, reusedExisting: false,
          errorCode: "UPSTREAM_FAILURE",
          errorSummary: "Download failed at https://cdn.example/media?token=private-value"
        }
      }
    }]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.activityDetail("access", "activity-unsafe"))
      .rejects.toThrow("unsafe error summary material");
  });

  it("refreshes media and requires schedule preview tokens for creator setting mutations", async () => {
    const creator = {
      creatorId: "creator-1", platform: "youtube", profileUrl: "https://youtube.com/@researcher",
      displayName: "Researcher", handle: "researcher", avatarUrl: null,
      saveFolderPath: "Research/YouTube", noteTemplateId: "default", mediaPolicy: "download_all", autoFetchEnabled: true,
      frequency: { every: 2, unit: "hour", displayText: "Every 2 hours" }, preferredTimes: [],
      timezone: "Asia/Shanghai", nextCheckAt: "2026-08-20T02:00:00Z", lastCheckedAt: null,
      lastResult: "idle", lastError: null, schedulerState: "scheduled",
      lastSavedAt: "2026-09-17T01:00:00Z", lastSavedCount: 12, lastSavedFetchRunId: "saved-run",
      activeJobId: null, activeJobTrigger: null
    };
    const transport = new FakeTransport([
      { success: true, data: { media: [{ mediaId: "media-1", mediaType: "image", downloadUrl: "https://cdn.example/refreshed.jpg" }] } },
      { success: true, data: {
        oldTimezone: "UTC", newTimezone: "Asia/Shanghai", oldNextCheckAt: null,
        newNextCheckAt: "2026-08-20T02:00:00Z", willRunImmediately: false, previewToken: "preview-1"
      } },
      { success: true, data: creator }
    ]);
    const client = new AgentLensApiClient(transport, IDENTITY);
    const settings = {
      saveFolderPath: "Research/YouTube", timezone: "Asia/Shanghai", every: 2, unit: "hour" as const,
      noteTemplateId: "default" as const, mediaPolicy: "download_all" as const
    };

    await expect(client.refreshMedia("access", "post-1", ["media-1"], "refresh-1"))
      .resolves.toEqual([expect.objectContaining({ id: "media-1", kind: "image" })]);
    const preview = await client.previewCreatorSettings("access", "creator-1", settings);
    await expect(client.updateCreatorSettings("access", "creator-1", settings, preview.previewToken, "settings-1"))
      .resolves.toMatchObject({ frequency: { every: 2, unit: "hour" }, saveFolderPath: "Research/YouTube" });
    expect(transport.requests[2]?.body).toMatchObject({ previewToken: "preview-1", frequency: { every: 2, unit: "hour" } });
  });

  it.each(["week", "minute"] as const)("round-trips a %s creator frequency", async (unit) => {
    const creator = {
      creatorId: "creator-weekly", followId: "account-follow", platform: "youtube", profileUrl: "https://youtube.com/@weekly",
      displayName: "Weekly", handle: "weekly", avatarUrl: null,
      saveFolderPath: "Research/Weekly", noteTemplateId: "default", mediaPolicy: "download_all", autoFetchEnabled: true,
      frequency: { every: 2, unit, displayText: `Every 2 ${unit}s` }, preferredTimes: ["09:00"],
      timezone: "Asia/Shanghai", nextCheckAt: "2026-09-18T01:00:00Z", lastCheckedAt: null,
      lastUpdateAt: null, importedCount: 0, retryAt: null,
      lastSavedAt: "2026-09-17T01:00:00Z", lastSavedCount: 12, lastSavedFetchRunId: "saved-run",
      lastResult: "idle", lastError: null, schedulerState: "scheduled",
      activeJobId: null, activeJobTrigger: null
    };
    const transport = new FakeTransport([{ success: true, data: creator },
      { success: true, data: [{ ...creator, lastSavedAt: null, lastSavedCount: null, lastSavedFetchRunId: null }] },
      { success: true, data: [{ ...creator, lastSavedFetchRunId: null }] },
      { success: true, data: [{ ...creator, lastSavedCount: 1.5 }] }]);
    const client = new AgentLensApiClient(transport, IDENTITY);

    await expect(client.updateCreatorSettings("access", "creator-weekly", {
      saveFolderPath: "Research/Weekly",
      timezone: "Asia/Shanghai",
      every: 2,
      unit,
      preferredTimes: ["09:00"],
      noteTemplateId: "default",
      mediaPolicy: "download_all"
    }, "preview-weekly", "settings-weekly")).resolves.toMatchObject({
      frequency: { every: 2, unit },
      lastSavedAt: "2026-09-17T01:00:00Z", lastSavedCount: 12, lastSavedFetchRunId: "saved-run",
      lastUpdateAt: null,
      importedCount: 0,
      retryAt: null
    });
    expect(transport.requests[0]?.body).toMatchObject({
      previewToken: "preview-weekly",
      frequency: { every: 2, unit }
    });
    const withoutSaved = await client.listCreators("access");
    expect(withoutSaved[0]).not.toHaveProperty("lastSavedAt");
    expect(withoutSaved[0]?.followId).toBe("account-follow");
    await expect(client.listCreators("access")).rejects.toThrow("lastSavedFetchRunId");
    await expect(client.listCreators("access")).rejects.toThrow("Invalid last saved statistics");
  });
});

it("loads the ordered Obsidian public catalog without credentials", async () => {
  const platforms = ["zhihu", "x"].map(id => ({id,label:id,single:true,profile:true,autoFetch:false,available:true}));
  const transport = new FakeTransport([{success:true,data:{clientType:"obsidian_plugin",platforms}}]);
  const result = await new AgentLensApiClient(transport, IDENTITY).publicPlatformCatalog();
  expect(result.platforms.map(p=>p.id)).toEqual(["zhihu","x"]);
  expect(transport.requests[0]).toMatchObject({path:"/v1/plugins/platform-catalog?clientType=obsidian_plugin"});
  expect(transport.requests[0]?.accessToken).toBeUndefined();
});
