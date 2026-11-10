import { expect, it } from "vitest";
import { requireRecoveryTarget, validateMediaRecoveryPolicy } from "../src/core/mediaRecoveryPolicy";
const policy = () => ({ version: 1, channel: "plugin_center" as const,
  expiresAt: new Date(Date.now() + 60_000).toISOString(), allowedHosts: ["tiktok.com", "agentlensapi.io"] });
it.each([
  "http://www.tiktok.com/v", "https://user:secret@www.tiktok.com/v", "https://www.tiktok.com:444/v",
  "https://127.0.0.1/v", "https://[::1]/v", "https://localhost/v", "https://www.tiktok.com\\@evil.example/v",
  "https://tiktok.com.evil.example/v", "https://eviltiktok.com/v"
])("does not authorize unsafe or suffix-confused recovery source %s", url => {
  expect(() => requireRecoveryTarget(url, policy())).toThrow();
});
it("allows the published root and subdomain without changing signed query bytes", () => {
  expect(requireRecoveryTarget("https://www.tiktok.com/play?sig=a%2Fb%3D&x=1#ignored", policy()).href)
    .toBe("https://www.tiktok.com/play?sig=a%2Fb%3D&x=1");
});
it.each([
  { version: 0 }, { channel: "beta" }, { expiresAt: "invalid" }, { expiresAt: "2000-01-01T00:00:00Z" },
  { allowedHosts: [] }, { allowedHosts: ["tiktok.com.evil.example", "https://tiktok.com"] }
])("rejects incomplete, expired or malformed policy snapshots (%j)", patch => {
  expect(() => validateMediaRecoveryPolicy({ ...policy(), ...patch })).toThrow();
});

it.each([...Array.from({ length: 32 }, (_, code) => code), 127])("rejects embedded ASCII control %i before URL normalization", code => {
  expect(() => requireRecoveryTarget(`https://www.tiktok.com/a${String.fromCharCode(code)}b`, policy())).toThrow();
});
it("rejects non-string policy hosts", () => {
  expect(() => validateMediaRecoveryPolicy({ ...policy(), allowedHosts: ["tiktok.com", 1] })).toThrow();
});
