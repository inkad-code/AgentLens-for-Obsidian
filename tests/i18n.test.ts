import { describe, expect, it } from "vitest";
import { resolveLocale, translate } from "@/i18n/catalog";

describe("AgentLens localization", () => {
  it("resolves supported Chinese locales and normalizes regional variants", () => {
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale("zh-SG")).toBe("zh-CN");
    expect(resolveLocale("zh-TW")).toBe("zh-TW");
    expect(resolveLocale("zh-HK")).toBe("zh-TW");
  });

  it("falls back to English and interpolates values without exposing template tokens", () => {
    expect(translate("zh-CN", "update.required.body", { version: "0.2.0" }))
      .toBe("需要 0.2.0 或更高版本才能执行在线操作。");
    expect(translate("zh-TW", "activity.creatorSettings")).toBe("Creator settings changed");
    expect(translate("fr-FR", "update.required.body", { version: "0.2.0" }))
      .toBe("Update AgentLens Social Importer to version 0.2.0 or newer to continue online actions.");
  });
});
