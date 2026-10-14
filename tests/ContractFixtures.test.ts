import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AgentLensApiClient } from "@/api/AgentLensApiClient";
import { validateAccountCapabilities, validateDeviceAuthorization } from "@/api/contracts";
import type { JsonTransport, TransportRequest } from "@/runtime/ObsidianRequestUrlTransport";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), "tests", "fixtures", `${name}.json`), "utf8"));
}

class FixtureTransport implements JsonTransport {
  constructor(private readonly response: unknown) {}
  async json<T>(_request: TransportRequest, validate: (value: unknown) => T): Promise<T> {
    return validate(this.response);
  }
}

const identity = {
  installationId: "install-1",
  deviceId: "device-1",
  clientVersion: "0.1.0",
  obsidianVersion: "1.13.7",
  platform: "desktop_macos" as const
};

describe("frozen Obsidian API fixtures", () => {
  it("validates device and capability response data", () => {
    const device = fixture("device-authorization") as { data: unknown };
    const capabilities = fixture("capabilities") as { data: unknown };
    expect(validateDeviceAuthorization(device.data).userCode).toBe("ABCD-EFGH");
    expect(validateAccountCapabilities(capabilities.data).platforms[0]?.id).toBe("youtube");
  });

  it("maps fetch and scheduler pages through the production client validators", async () => {
    const fetchClient = new AgentLensApiClient(new FixtureTransport(fixture("fetch-page")), identity);
    const fetch = await fetchClient.fetch("access", { url: "https://youtube.com/watch?v=video-42", mode: "single_post" }, "idem", "request");
    expect(fetch.content[0]?.contentId).toBe("video-42");

    const updatesClient = new AgentLensApiClient(new FixtureTransport(fixture("creator-updates")), identity);
    const updates = await updatesClient.manualCreatorUpdates("access", "creator-1", "request", "idem");
    expect(updates).toMatchObject({ leaseId: "manual-run-1", coverageComplete: true, hasMore: false });
  });

  it("validates the authoritative Activity page fixture", async () => {
    const client = new AgentLensApiClient(new FixtureTransport(fixture("activity-page")), identity);
    await expect(client.activity("access", { operation: "single_fetch" }))
      .resolves.toMatchObject({
        retentionDays: 90,
        nextCursor: "opaque.cursor.signature",
        items: [{ operation: "single_fetch", relativeNotePath: "AgentLens/Inbox/source.md" }]
      });
  });
});
