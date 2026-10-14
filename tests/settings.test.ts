import { describe, expect, it } from "vitest";
import { normalizeAgentLensSettings } from "@/settings";

describe("AgentLens settings", () => {
  it("preserves a weekly Auto-Fetch default within the supported range", () => {
    expect(normalizeAgentLensSettings({
      defaultAutoEvery: 12,
      defaultAutoUnit: "week"
    })).toMatchObject({ defaultAutoEvery: 12, defaultAutoUnit: "week" });
  });

  it("normalizes a weekly Auto-Fetch default above twelve weeks", () => {
    expect(normalizeAgentLensSettings({
      defaultAutoEvery: 13,
      defaultAutoUnit: "week"
    })).toMatchObject({ defaultAutoEvery: 12, defaultAutoUnit: "week" });
  });

  it("preserves supported locales and falls back to English", () => {
    expect(normalizeAgentLensSettings({ locale: "zh-TW" })).toMatchObject({ locale: "zh-TW" });
    expect(normalizeAgentLensSettings({ locale: "fr-FR" as "en" })).toMatchObject({ locale: "en" });
  });
});
