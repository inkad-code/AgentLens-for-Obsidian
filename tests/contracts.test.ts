import { describe, expect, it } from "vitest";
import { validateAccountCapabilities, validateDeviceAuthorization } from "@/api/contracts";

describe("API contract validation", () => {
  it("accepts a capability-driven platform response", () => {
    expect(validateAccountCapabilities({
      accountId: "account-1",
      plan: "pro",
      quotaRemaining: 42,
      minimumPluginVersion: "0.1.0",
      latestPluginVersion: "0.1.1",
      supportUrl: "https://agentlens.example/support",
      releaseNotesUrl: "https://agentlens.example/releases/0.1.1",
      platforms: [{
        id: "youtube",
        label: "YouTube",
        single: true,
        profile: true,
        autoFetch: true,
        profileScope: "creator",
        mediaDownload: true,
        transcript: true,
        available: true
      }]
    }).platforms[0]).toMatchObject({ id: "youtube", profile: true });
  });

  it("allows HTTP verification only for loopback development origins", () => {
    expect(validateDeviceAuthorization({
      deviceCode: "device",
      userCode: "code",
      verificationUri: "http://127.0.0.1:5173/device",
      verificationUriComplete: "http://localhost:5173/device?code=ABCD-EFGH",
      expiresIn: 600,
      interval: 5
    })).toMatchObject({ verificationUri: "http://127.0.0.1:5173/device" });

    expect(() => validateDeviceAuthorization({
      deviceCode: "device",
      userCode: "code",
      verificationUri: "http://agentlens.example/device",
      expiresIn: 600,
      interval: 5
    })).toThrow(/HTTPS or an HTTP loopback address/);
  });

  it("rejects incomplete capability DTOs", () => {
    expect(() => validateAccountCapabilities({ accountId: "a", plan: "free", quotaRemaining: 1, platforms: [] })).toThrow(/minimumPluginVersion/);
  });
});
