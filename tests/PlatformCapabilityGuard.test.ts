import { describe, expect, it } from "vitest";
import { requirePublicLink } from "@/api/PlatformCapabilityGuard";

describe("shared server link authority", () => {
  it.each(["http://xhslink.cn/o/a", "https://xhslink.com/a", "https://threads.com/@creator", "https://new-social.example/post/1"])("lets the server decide support for %s", url => {
    expect(() => requirePublicLink(url)).not.toThrow();
  });
  it.each(["not a link", "file:///tmp/a", "javascript:alert(1)", "https://name:secret@example.com/a"])("rejects malformed or credential-bearing input %s", url => {
    expect(() => requirePublicLink(url)).toThrow();
  });
});
