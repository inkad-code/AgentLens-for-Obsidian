import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SupportedPlatforms } from "../src/ui/workbench/shared";
import type { AccountCapabilities } from "../src/api/contracts";

function capabilities(available: boolean): AccountCapabilities {
  return {
    accountId: "account-1", plan: "pro", quotaRemaining: 1,
    minimumPluginVersion: "0.1.0", latestPluginVersion: "0.1.0",
    supportUrl: "https://agentlens.example/support", releaseNotesUrl: "https://agentlens.example/releases/0.1.0",
    platforms: [
      { id: "youtube", label: "YouTube", single: true, profile: true, autoFetch: true, profileScope: "creator", mediaDownload: true, transcript: true, available },
      { id: "reddit", label: "Reddit", single: true, profile: true, autoFetch: true, profileScope: "subreddits_only", mediaDownload: true, transcript: false, available: true }
    ]
  };
}

const styles = readFileSync("styles.css", "utf8");

describe("SupportedPlatforms", () => {
  it("matches Eagle by hiding unavailable platforms and unknown icons", () => {
    const caps = capabilities(false);
    const view = render(<SupportedPlatforms capabilities={{...caps, platforms:[...caps.platforms, {...caps.platforms[1]!,id:"future-platform"}]}} mode="autoFetch" />);
    expect(screen.queryByLabelText("YouTube · plan upgrade")).toBeNull();
    expect(screen.getByLabelText("Reddit: subreddit links only")).not.toHaveAttribute("title");
    expect(view.container.querySelectorAll(".agentlens-platform-icon")).toHaveLength(1);
  });

  it("labels a signed-out icon with the platform name alone", () => {
    render(<SupportedPlatforms capabilities={null} publicCatalog={{clientType: "obsidian_plugin", platforms: [{id:"pinterest",label:"Pinterest",single:true,profile:true,autoFetch:false,available:true}]}} mode="single" />);

    const icon = screen.getByLabelText("Pinterest");
    expect(icon.getAttribute("aria-label")).toBe("Pinterest");
    expect(icon).not.toHaveAttribute("title");
    expect(icon.closest(".agentlens-platforms")).not.toBeNull();
    expect(screen.queryByLabelText(/sign in to check availability/)).toBeNull();
  });

  it("suppresses the row's own bubble while keeping the icon bubbles", () => {
    render(<SupportedPlatforms capabilities={capabilities(true)} mode="profile" />);

    // 行级 aria-label 保留给读屏但不弹气泡；图标要弹（显示平台名），所以显式重置回 false
    expect(screen.getByLabelText("Bulk Fetch supported platforms")).toBeTruthy();
    expect(styles).toMatch(/\.agentlens-platforms\s*\{[^}]*--no-tooltip:\s*true/);
    expect(styles).toMatch(/\.agentlens-platforms\s*>\s*span\[aria-label\]\s*\{[^}]*--no-tooltip:\s*false/);
  });

  it("keeps the hover lift on the icons", () => {
    expect(styles).toMatch(/@media\s*\(hover:\s*hover\)\s*\{[\s\S]*span\[aria-label\]:hover[\s\S]*translateY\(-2px\)/);
  });
});


describe("server platform order", () => {
  it("preserves arbitrary server order and mode flags for guests and accounts", () => {
    const platforms = ["zhihu", "youtube", "pinterest", "x"].map(id => ({id,label:id,single:true,profile:id!=="x",autoFetch:false,available:true}));
    const catalog = {clientType:"obsidian_plugin",platforms};
    const view = render(<SupportedPlatforms capabilities={null} publicCatalog={catalog} mode="single" />);
    const ids = () => [...view.container.querySelectorAll(".agentlens-platforms > span[aria-label]")].map(x=>x.getAttribute("aria-label"));
    expect(ids()).toEqual(["zhihu","youtube","pinterest","x"]);
    view.rerender(<SupportedPlatforms capabilities={null} publicCatalog={catalog} mode="profile" />);
    expect(ids()).toEqual(["zhihu","youtube","pinterest"]);
    view.rerender(<SupportedPlatforms capabilities={{...capabilities(true), platforms:platforms.map(p=>({...p,profileScope:"creator",mediaDownload:true,transcript:false}))}} mode="single" />);
    expect(ids()).toEqual(["zhihu","youtube","pinterest","x"]);
    expect(catalog.platforms.map(p=>p.id)).toEqual(["zhihu","youtube","pinterest","x"]);
  });
  it("does not invent guest platforms when the server catalog is missing", () => {
    const view = render(<SupportedPlatforms capabilities={null} catalogError mode="single" />);
    expect(view.container.querySelectorAll(".agentlens-platform-icon")).toHaveLength(0);
    expect(view.container.textContent).toContain("Platform list unavailable");
  });
});


it("keeps last good icons visible with a refresh failure status", () => {
  const view = render(<SupportedPlatforms capabilities={capabilities(true)} catalogError mode="single" />);
  expect(view.container.querySelectorAll(".agentlens-platform-icon")).toHaveLength(2);
  expect(screen.getByRole("status")).toHaveTextContent("Showing last available platforms");
});
