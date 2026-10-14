import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanPostText } from "@/core/domain";
import { RemoteImage, RemoteImageContext } from "@/ui/workbench/RemoteImage";
import { SupportedPlatforms } from "@/ui/workbench/shared";
import type { AccountCapabilities } from "@/api/contracts";

afterEach(() => vi.restoreAllMocks());

describe("0922 feedback", () => {
  it("keeps adjacent provider topic tags separated and removes invisible separators", () => {
    expect(cleanPostText("#巴西[话题]##世界历史[话题]# ＃摄影\u200b")).toBe("#巴西 #世界历史  #摄影");
  });

  it("retries blocked image rendering through the host and releases the object URL", async () => {
    const create = vi.fn(() => "blob:avatar");
    const revoke = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const load = vi.fn(async () => new Blob(["image"], { type: "image/png" }));
    const { unmount } = render(<RemoteImageContext.Provider value={load}><RemoteImage url="https://cdn.example/avatar.jpg" className="avatar" alt="Creator" /></RemoteImageContext.Provider>);
    fireEvent.error(screen.getByRole("img"));
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "blob:avatar"));
    expect(load).toHaveBeenCalledTimes(1);
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:avatar");
    vi.unstubAllGlobals();
  });

  it("shows the same public platform catalog before and after sign-in", () => {
    const ids = ["bilibili", "bluesky", "douyin", "facebook", "instagram", "kick", "kuaishou", "lemon8", "linkedin", "pinterest", "reddit", "snapchat", "threads", "tiktok", "twitch", "vimeo", "wechat_channels", "wechat_official_account", "weibo", "x", "xiaohongshu", "xigua", "youtube", "zhihu"];
    const singleOnly = new Set(["twitch", "pinterest", "bluesky", "vimeo", "kick"]);
    const capabilities = { platforms: ids.map(id => ({ id, label: id, available: true, single: true, profile: !singleOnly.has(id), autoFetch: !singleOnly.has(id) })) } as unknown as AccountCapabilities;
    for (const mode of ["single", "profile", "autoFetch"] as const) {
      const { container, rerender, unmount } = render(<SupportedPlatforms mode={mode} capabilities={null} publicCatalog={{clientType:"obsidian_plugin",platforms:capabilities.platforms}} />);
      const guest = [...container.querySelectorAll(".agentlens-platforms > span[aria-label]")].map(el => el.getAttribute("aria-label"));
      rerender(<SupportedPlatforms mode={mode} capabilities={capabilities} />);
      const signedIn = [...container.querySelectorAll(".agentlens-platforms > span[aria-label]")].map(el => el.getAttribute("aria-label"));
      expect(signedIn).toEqual(guest);
      unmount();
    }
  });
});
