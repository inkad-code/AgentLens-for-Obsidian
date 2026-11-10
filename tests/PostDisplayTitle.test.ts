import { describe, expect, it } from "vitest";
import { cleanPostTitle, postListSummary, postDisplayTitle, postListTitle, type NormalizedPost } from "@/core/domain";
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

 describe("postListSummary", () => {
  it("shows Zhihu HTML excerpts as readable text without modifying the article", () => {
    const article = {...post, text: '<h2>1、订期社</h2><p data-pid="zOcmHcCx">网址：<a href="https://example.com">网站</a></p><p>下一段 &amp; 更多</p>'};
    expect(postListSummary(article)).toBe('1、订期社 网址： 网站 下一段 & 更多');
    expect(article.text).toContain('<h2>');
  });
  it("decodes escaped HTML and keeps ordinary captions readable", () => {
    expect(postListSummary({...post, text: '&lt;p data-pid=&quot;abc&quot;&gt;很多医学生&lt;/p&gt;'})).toBe('很多医学生');
    expect(postListSummary({...post, text: '普通文案 & 链接 https://example.com'})).toBe('普通文案 & 链接 https://example.com');
  });
});
