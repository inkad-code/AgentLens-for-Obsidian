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
