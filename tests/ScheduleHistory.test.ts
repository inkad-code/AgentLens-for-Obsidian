import { describe, expect, it } from "vitest";
import { AgentLensApiClient } from "@/api/AgentLensApiClient";
import { validateScheduleHistory } from "@/api/scheduleHistory";
import type { JsonTransport, TransportRequest } from "@/runtime/ObsidianRequestUrlTransport";

const revision = (number: number) => ({ revision: number, effectiveAt: "2026-09-21T10:00:00Z", anchorAt: "2026-09-20T10:00:00Z",
  frequencyEvery: 1, frequencyUnit: "hour", autoFetchEnabled: true, deleted: false, legacySnapshot: false });
const page = { followId: "follow/1", throughRevision: 101, revisions: Array.from({ length: 100 }, (_, index) => revision(index + 1)), nextAfterRevision: 100 };

describe("shared schedule history", () => {
  it("reads multiple bounded pages with the original server boundary and installation", async () => {
    const requests: TransportRequest[] = [];
    const responses = [{ success: true, data: page }, { success: true, data: { ...page, revisions: [revision(101)], nextAfterRevision: null } }];
    const transport: JsonTransport = { json: async (request, validate) => { requests.push(request); return validate(responses.shift()); } };
    const client = new AgentLensApiClient(transport, { installationId: "install", deviceId: "device", clientVersion: "0.1.1", obsidianVersion: "1.13.7", platform: "desktop_macos" });
    const first = await client.scheduleHistory("token", "follow/1");
    const second = await client.scheduleHistory("token", "follow/1", first.nextAfterRevision!, first.throughRevision);
    expect(second.revisions.map(row => row.revision)).toEqual([101]);
    expect(requests).toEqual([
      { path: "/v1/plugins/follows/follow%2F1/schedule-history?afterRevision=0", method: "GET", accessToken: "token", installationId: "install" },
      { path: "/v1/plugins/follows/follow%2F1/schedule-history?afterRevision=100&throughRevision=101", method: "GET", accessToken: "token", installationId: "install" }
    ]);
    await expect(async () => client.scheduleHistory("token", "follow/1", 100)).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });

  it.each([
    { ...page, followId: "another" },
    { ...page, throughRevision: 102 },
    { ...page, revisions: [revision(2)] },
    { ...page, revisions: [revision(1), revision(1)] },
    { ...page, nextAfterRevision: 99 },
    { ...page, nextAfterRevision: null },
    { ...page, revisions: [] },
    { ...page, revisions: Array.from({ length: 101 }, (_, i) => revision(i + 1)) },
    { ...page, revisions: [{ ...revision(1), effectiveAt: "2026-09-21T10:00:00" }] },
    { ...page, revisions: [{ ...revision(1), frequencyEvery: 1.5 }] },
    { ...page, revisions: [{ ...revision(1), autoFetchEnabled: "false" }] }
  ])("rejects incomplete or mismatched evidence %#", data => {
    expect(() => validateScheduleHistory(data, "follow/1", 0, 101)).toThrow();
  });

  it("preserves pause, removal and legacy evidence instead of inferring execution", () => {
    const row = { ...revision(1), autoFetchEnabled: false, deleted: true, legacySnapshot: true };
    expect(validateScheduleHistory({ followId: "f", throughRevision: 1, revisions: [row], nextAfterRevision: null }, "f", 0).revisions).toEqual([row]);
  });
});
