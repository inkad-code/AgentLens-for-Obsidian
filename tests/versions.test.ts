import { describe, expect, it } from "vitest";
import { compareVersions, versionAtLeast } from "@/core/versions";

describe("version comparison", () => {
  it("compares unequal and differently padded semantic versions", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
  });

  it("checks a current version against a minimum without duplicating UI policy", () => {
    expect(versionAtLeast("1.2.0", "1.1.9")).toBe(true);
    expect(versionAtLeast("1.1.8", "1.1.9")).toBe(false);
  });
  it.each([
    ["1.0.0-beta.2", "1.0.0-beta.10"],
    ["1.0.0-beta.10", "1.0.0"],
    ["1.0.0-alpha", "1.0.0-alpha.1"],
    ["1.0.0-1", "1.0.0-alpha"],
    ["1.0.0-alpha", "1.0.0-beta"],
    ["1.0.0-beta.9007199254740992", "1.0.0-beta.9007199254740993"]
  ])("orders prerelease %s before %s", (before, after) => {
    expect(compareVersions(before, after)).toBeLessThan(0);
    expect(compareVersions(after, before)).toBeGreaterThan(0);
    expect(versionAtLeast(before, after)).toBe(false);
  });

  it("ignores build metadata and accepts the backend version prefix", () => {
    expect(compareVersions("v1.2.3+build.9", "1.2.3+build.10")).toBe(0);
    expect(compareVersions("V1.2.3-beta.2+9", "1.2.3-beta.2+10")).toBe(0);
    expect(compareVersions("1.0", "1.0.0-beta.2")).toBeGreaterThan(0);
  });

});
