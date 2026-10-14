import { describe, expect, it } from "vitest";
import { cleanPostTitle, postDisplayTitle, postListTitle, type NormalizedPost } from "@/core/domain";
const post: NormalizedPost = {platform: "douyin", contentId: "opaque-hash", canonicalUrl: "https://example.com", text: "作品文案标题\n更多内容", author: {id: "1", displayName: "Creator"}, media: []};
describe("postDisplayTitle", () => {
  it("uses the requested note title while keeping captions in list titles", () => {
    expect(postDisplayTitle({...post, title: "作品标题"})).toBe("作品标题");
    expect(postDisplayTitle({...post, title: "  "})).toBe("Post from Creator");
    expect(postListTitle({...post, title: "  "})).toBe("作品文案标题");
    expect(postDisplayTitle({...post, text: ""})).toBe("Post from Creator");
    expect(postDisplayTitle({...post, title: '<p data-pid="1">知乎标题</p>'})).toBe("知乎标题");
    expect(postDisplayTitle({...post, title: "A &amp; B"})).toBe("A & B");
  });

  it.each(["zhihu", "linkedin", "reddit", "douyin"])("cleans an encoded title on %s", platform => {
    expect(postDisplayTitle({ ...post, platform, title: "&lt;p&gt;A &amp; B&lt;/p&gt;" })).toBe("A & B");
  });

  it("removes numeric-encoded tags and provider comments before showing a title", () => {
    expect(cleanPostTitle("&#60;h2&#62;Useful&#32;title&#60;/h2&#62;<!--source-->"))
      .toBe("Useful title");
  });
});
