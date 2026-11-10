import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformIcon } from "../src/ui/workbench/shared";

// The current 24-platform catalog, including platforms hidden in specific workflows.
const platforms = [
  "bilibili", "bluesky", "douyin", "facebook", "instagram", "kick",
  "kuaishou", "lemon8", "linkedin", "pinterest", "reddit", "snapchat",
  "threads", "tiktok", "twitch", "vimeo", "wechat_channels",
  "wechat_official_account", "weibo", "x", "xiaohongshu", "xigua",
  "youtube", "zhihu"
];

describe("platform icons", () => {
  it.each(["glyph", "creator", "author"] as const)("keeps the complete Xiaohongshu wordmark in the %s viewport", variant => {
    const { container } = render(<PlatformIcon id="xiaohongshu" variant={variant} />);
    const source = container.querySelector("img")!.getAttribute("src")!;
    const svg = new DOMParser().parseFromString(decodeURIComponent(source.split(",")[1]!), "image/svg+xml");
    const [x, y, width, height] = svg.documentElement.getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number];
    // The exported red wordmark occupies x=6..30 and y=13.5..22.23.
    expect(x).toBeLessThanOrEqual(6);
    expect(x + width).toBeGreaterThanOrEqual(30);
    expect(y).toBeLessThanOrEqual(13.5);
    expect(y + height).toBeGreaterThanOrEqual(22.23);
    expect(svg.querySelector('path[fill="#FF0035"]')).not.toBeNull();
  });

  it("renders a valid Figma SVG badge for every current platform", () => {
    expect(platforms).toHaveLength(24);

    for (const id of platforms) {
      const { container, unmount } = render(<PlatformIcon id={id} />);
      const image = container.querySelector(".agentlens-platform-icon img");
      expect(image, id).not.toBeNull();

      const source = image!.getAttribute("src")!;
      expect(source, id).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      const svg = new DOMParser().parseFromString(decodeURIComponent(source.split(",")[1]!), "image/svg+xml");
      expect(svg.querySelector("parsererror"), id).toBeNull();
      expect(svg.documentElement.getAttribute("viewBox"), id).toBe("0 0 36 36");
      unmount();
    }
  });
});
