import { describe, expect, it } from "vitest";
import { postBodyMarkdown } from "@/core/postBodyMarkdown";

describe("provider article content", () => {
  it("keeps Markdown unchanged", () => {
    const markdown = "# Heading\n\nParagraph\n\n- one\n- two";
    expect(postBodyMarkdown(markdown)).toBe(markdown);
  });
  it("preserves paragraph, list, image and link order without executable markup", () => {
    const result = postBodyMarkdown('<h2>Title</h2><p>First<br>line &amp; more</p><img data-src="https://cdn.example/a.jpg"><p>Second <strong>bold</strong> <a href="https://example.com">link</a></p><ul><li>One</li><li>Two</li></ul><script>bad()</script><a href="javascript:bad()">safe text</a>', url => url.endsWith("a.jpg") ? "![[attachments/a.jpg]]" : undefined);
    expect(result).toContain("## Title\n\nFirst\nline & more");
    expect(result).toContain("![[attachments/a.jpg]]\n\nSecond **bold** [link](https://example.com)");
    expect(result).toContain("- One");
    expect(result).toContain("- Two");
    expect(result).toContain("safe text");
    expect(result).not.toMatch(/bad\(|<p>|<script>|javascript:/);
  });
  it("retains code whitespace and uses a fence longer than embedded backticks", () => {
    expect(postBodyMarkdown("<pre>  first\n    second\n```</pre>")).toContain("````\nfirst\n    second\n```\n````");
  });
});
