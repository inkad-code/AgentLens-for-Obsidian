import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchApp } from "@/ui/WorkbenchApp";
import { DEMO_URL } from "@/workbench/AgentLensWorkbenchService";
import { SINGLE_DEMO_LINK, BULK_DEMO_LINK } from "@/ui/workbench/demoLinks";
import type { AgentLensWorkbenchPort } from "@/workbench/ports";
import type { BatchSaveResult, PreviewResult, PreparedSave, WriteOptions } from "@/workbench/types";
import type { NoteWriteManifest } from "@/vault/VaultWriter";
import { AgentLensError } from "@/core/errors";
import type { CreatorRecord } from "@/api/AgentLensApiClient";
import type { NormalizedPost } from "@/core/domain";

function creator(overrides: Partial<CreatorRecord> = {}): CreatorRecord {
  return {
    creatorId: "creator-1",
    platform: "youtube",
    profileUrl: "https://youtube.com/@creator",
    displayName: "Scheduled Creator",
    handle: "creator",
    avatarUrl: null,
    saveFolderPath: "AgentLens/Creators/Creator",
    noteTemplateId: "default",
    mediaPolicy: "download_all",
    autoFetchEnabled: true,
    frequency: { every: 4, unit: "hour" },
    timezone: "Asia/Shanghai",
    preferredTimes: [],
    nextCheckAt: "2026-08-20T12:00:00Z",
    lastCheckedAt: "2026-08-20T08:00:00Z",
    lastUpdateAt: null,
    lastResult: "no_update",
    lastError: null,
    importedCount: 0,
    schedulerState: "scheduled",
    retryAt: null,
    activeJobId: null,
    activeJobTrigger: null,
    ...overrides
  };
}

function signedInService(): AgentLensWorkbenchPort {
  const capabilities = {
    accountId: "user-1", plan: "pro", quotaRemaining: 99,
    minimumPluginVersion: "0.1.0", latestPluginVersion: "0.1.0", supportUrl: "https://agentlens.example/support", releaseNotesUrl: "https://agentlens.example/releases/0.1.0",
    platforms: [
      { id: "youtube", label: "YouTube", single: true, profile: true, autoFetch: true, profileScope: "creator", mediaDownload: true, transcript: true, available: true },
      { id: "reddit", label: "Reddit", single: true, profile: true, autoFetch: true, profileScope: "subreddits_only", mediaDownload: true, transcript: false, available: true }
    ]
  } as const;
  const posts: NormalizedPost[] = [
    {
      platform: "youtube", contentId: "post-a", canonicalUrl: "https://youtube.com/watch?v=post-a",
      title: "Post A", text: "Research A", publishedAt: "2026-08-19T12:00:00Z",
      author: { id: "creator-1", displayName: "Creator", handle: "creator" }, transcript: "Transcript A",
      media: [{ id: "media-a", kind: "video" as const, sourceUrl: "https://cdn.example/video.mp4", thumbnailUrl: "https://cdn.example/thumb.jpg", sizeBytes: 2048 }]
    },
    {
      platform: "youtube", contentId: "post-b", canonicalUrl: "https://youtube.com/watch?v=post-b",
      title: "Post B", text: "Research B", publishedAt: "2026-08-18T12:00:00Z",
      author: { id: "creator-1", displayName: "Creator", handle: "creator" }, media: []
    }
  ];
  const plan = vi.fn(async (post: typeof posts[number], options: WriteOptions = {}): Promise<NoteWriteManifest> => ({
    contentKey: `youtube:${post.contentId}`,
    notePath: `${options.folderPath ?? "AgentLens/Inbox"}/${post.contentId}.md`,
    action: "new", reason: "New note", managedDigest: post.contentId,
    mediaPolicy: options.mediaPolicy === "link_only" || options.mediaPolicy === "download_images_only" ? options.mediaPolicy : "download_all",
    templateId: options.templateId === "compact" ? "compact" : "default",
    expectedOutcome: "complete",
    partialReasons: [],
    renderedManagedBlock: `# ${post.title}\n\n${post.text}`,
    frontmatter: { agentlens_content_id: post.contentId, source_url: post.canonicalUrl },
    attachments: post.media.map((media) => ({ mediaId: media.id, path: `attachments/${media.id}.mp4`, sourceUrl: media.sourceUrl, action: options.mediaPolicy === "link_only" ? "link" as const : "new" as const }))
  }));
  const unused = async (): Promise<never> => { throw new Error("Unused test service method."); };
  return {
    authState: () => ({ status: "signed_in", accessToken: "access", accessTokenExpiresAt: Date.now() + 60_000 }),
    subscribeAuth: () => () => undefined,
    restoreAuth: async () => ({ status: "signed_in", accessToken: "access", accessTokenExpiresAt: Date.now() + 60_000 }),
    startSignIn: unused,
    pollSignIn: unused,
    signOut: async () => undefined,
    capabilities: async () => capabilities,
    account: async () => ({
      user: { id: "user-1", email: "user@example.com", name: "User" }, installationId: "install-1",
      subscription: { plan: "pro", status: "active", periodEnd: null, remainingQuota: 99, totalQuota: 100, addOnBalance: 0, quotaRefreshAt: null, cancelAtPeriodEnd: false, billingUrl: "https://agentlens.example/billing", fetchAllowed: true, fetchBlockedReason: null }
    }),
    clientVersion: () => "0.1.0",
    activity: unused,
    activityDetail: unused,
    scheduleHistory: unused,
    accountFollows: unused,
    unfollowAccount: unused,
    exportActivity: unused,
    previewSingle: vi.fn(async () => ({ post: posts[0]!, fetchId: "fetch-single", usage: { charged: true, units: 1, remaining: 98 }, usageRemaining: 98, demo: false })),
    fetchProfilePage: vi.fn(async () => ({ fetchId: "fetch-1", mode: "profile_page" as const, platform: "youtube", content: posts, page: { cursor: null, hasMore: false, pageNumber: 1 }, usage: { charged: true, units: 1, remaining: 98 } })),
    planPreview: async (preview: PreviewResult, options: WriteOptions = {}) => plan(preview.post as typeof posts[number], options),
    savePrepared: vi.fn(),
    autoFetchSetup: async () => ({ settings: { homeTimezone: "Asia/Shanghai", confirmed: true }, creators: [] }),
    confirmTimezone: async () => undefined,
    parseCreator: unused,
    followCreator: unused,
    setCreatorEnabled: unused,
    previewCreatorSettings: unused,
    updateCreatorSettings: unused,
    deleteCreator: async () => undefined,
    runScheduled: unused,
    runCreatorNow: unused,
    retryCreator: unused,
    importCreatorBaseline: unused
  };
}

function successfulSave(
  manifest: NoteWriteManifest,
  completion: "complete" | "partial" = "complete",
  attachments: BatchSaveResult["successes"][number]["write"]["attachments"] = []
): BatchSaveResult["successes"][number] {
  const timestamp = "2026-08-20T00:00:00Z";
  return {
    callback: "acknowledged",
    write: {
      manifest,
      file: { path: manifest.notePath },
      ledger: {
        destination: "obsidian",
        contentKey: manifest.contentKey,
        contentId: manifest.contentKey.split(":").at(-1) ?? manifest.contentKey,
        effectivePostKey: manifest.contentKey,
        notePath: manifest.notePath,
        attachmentPaths: attachments.map(({ path }) => path),
        media: attachments.map(({ mediaId, path, status }) => ({ mediaKey: mediaId, path, status })),
        sourceUrl: String(manifest.frontmatter.source_url ?? "https://example.com/source"),
        mediaPolicy: manifest.mediaPolicy,
        writtenAt: timestamp,
        firstWrittenAt: timestamp,
        lastVerifiedAt: timestamp,
        physicalStatus: completion === "complete" ? "active" : "partial",
        lastActionId: "test-action",
        managedDigest: manifest.managedDigest,
        status: manifest.action === "new" ? "written" : "updated",
        completion
      },
      attachments
    }
  };
}

describe("WorkbenchApp", () => {
  it("opens plans from Billing & Usage and preserves the fetch draft on return", async () => {
    render(<WorkbenchApp service={signedInService()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Account menu" })).toHaveTextContent("pro"));
    const input = screen.getByRole("textbox", { name: /link|url/i });
    fireEvent.change(input, { target: { value: "https://youtube.com/watch?v=draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Billing & Usage" }));
    expect(screen.getByRole("region", { name: "Choose a plan" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /link|url/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(input).toBeVisible();
    expect(input).toHaveValue("https://youtube.com/watch?v=draft");
  });
  it("blocks a new parse while the previous provider outcome needs reconciliation", async () => {
    const service = signedInService();
    service.previewSingle = vi.fn().mockRejectedValue(new AgentLensError("unknown", "Pending verification", false,
      409, undefined, "request", {failureClass: "reconciliation_required", retryable: false}));
    render(<WorkbenchApp service={service} initialUrl="https://youtube.com/watch?v=1" />);
    await screen.findByRole("button", {name: "Account menu"});
    await waitFor(() => expect(screen.getByLabelText("Public post URL")).toHaveValue("https://youtube.com/watch?v=1"));
    const parse = screen.getByRole("button", {name: "Fetch preview"});
    await waitFor(() => expect(parse).toBeEnabled());
    fireEvent.click(parse);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t confirm whether this action finished. Contact Support before trying again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("reconciliation_required");
    expect(parse).toBeDisabled();
    expect(service.previewSingle).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Public post URL"), {target: {value: "https://youtube.com/watch?v=2"}});
    expect(parse).toBeEnabled();
  });

  it("renders the Workbench navigation in the selected locale", async () => {
    render(<WorkbenchApp locale="zh-CN" />);

    expect(screen.getByRole("heading", { name: "AgentLens" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "单条抓取" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "批量抓取" })).toBeVisible();
    expect(screen.getByRole("button", { name: "自动抓取" })).toBeVisible();
  });

  it("names the workbench region without an aria-label hover bubble", () => {
    render(<WorkbenchApp />);

    const region = screen.getByRole("region", { name: "AgentLens workbench" });
    expect(region).not.toHaveAttribute("aria-label");
  });

  it("shows a dismissible optional update and persists dismissal for that version", async () => {
    const service = signedInService();
    const setUiPreferences = vi.fn(async () => undefined);
    Object.assign(service as object, {
      capabilities: async () => ({
        ...(await signedInService().capabilities()),
        minimumPluginVersion: "0.1.0",
        latestPluginVersion: "0.2.0"
      }),
      uiPreferences: async () => ({}),
      setUiPreferences
    });
    render(<WorkbenchApp service={service} />);

    const notice = await screen.findByRole("status", { name: "Update available" });
    expect(notice).toHaveTextContent("Version 0.2.0 is available");
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss this version" }));
    await waitFor(() => expect(setUiPreferences).toHaveBeenCalledWith({ dismissedUpdateVersion: "0.2.0" }));
    expect(screen.queryByRole("status", { name: "Update available" })).not.toBeInTheDocument();
  });

  it("keeps a required update visible without a dismiss action", async () => {
    const service = signedInService();
    Object.assign(service as object, {
      capabilities: async () => ({
        ...(await signedInService().capabilities()),
        minimumPluginVersion: "0.2.0",
        latestPluginVersion: "0.2.1"
      })
    });
    render(<WorkbenchApp service={service} />);

    const notice = await screen.findByRole("alert", { name: "Update required" });
    expect(notice).toHaveTextContent("Update AgentLens Social Importer to version 0.2.0 or newer");
    expect(within(notice).queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });

  it("opens the workbench directly without a first-run introduction", async () => {
    const service = signedInService();
    const setUiPreferences = vi.fn(async () => undefined);
    Object.assign(service as object, {
      uiPreferences: async () => ({}),
      setUiPreferences
    });
    render(<WorkbenchApp service={service} />);

    await screen.findByRole("heading", { name: "Fetch from social media" });
    expect(screen.queryByRole("dialog", { name: "Build a traceable research vault" })).not.toBeInTheDocument();
    expect(setUiPreferences).not.toHaveBeenCalled();
    expect(service.previewSingle).not.toHaveBeenCalled();
  });

  it("does not reopen completed onboarding", async () => {
    const service = signedInService();
    Object.assign(service as object, { uiPreferences: async () => ({ onboardingVersion: 1 }) });
    render(<WorkbenchApp service={service} />);

    await screen.findByRole("heading", { name: "Fetch from social media" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Build a traceable research vault" })).not.toBeInTheDocument());
  });
  it("waits for session restoration before loading account data or enabling live actions", async () => {
    const service = signedInService();
    let finishRestore: (() => void) | undefined;
    const restoreAuth = vi.fn(() => new Promise<ReturnType<typeof service.authState>>((resolve) => {
      finishRestore = () => resolve(service.authState());
    }));
    const capabilities = vi.spyOn(service, "capabilities");
    const account = vi.spyOn(service, "account");
    service.restoreAuth = restoreAuth;

    render(<WorkbenchApp service={service} />);

    expect(screen.getByLabelText("Account status")).toHaveTextContent("Restoring…");
    expect(screen.getByRole("button", { name: "Fetch demo" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Public post URL" })).toHaveAttribute("readonly");
    expect(capabilities).not.toHaveBeenCalled();
    expect(account).not.toHaveBeenCalled();

    finishRestore?.();
    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    expect(capabilities).toHaveBeenCalledTimes(1);
    expect(account).toHaveBeenCalledTimes(1);
  });

  it("offers a saved-session retry after a temporary restore outage", async () => {
    const service = signedInService();
    let listener: ((state: ReturnType<typeof service.authState>) => void) | undefined;
    const unavailable = { status: "error" as const, reason: "refresh_unavailable" as const };
    const signedIn = service.authState();
    const restoreAuth = vi.fn()
      .mockResolvedValueOnce(unavailable)
      .mockImplementationOnce(async () => {
        listener?.(signedIn);
        return signedIn;
      });
    service.authState = () => unavailable;
    service.restoreAuth = restoreAuth;
    service.subscribeAuth = (next) => {
      listener = next;
      return () => { listener = undefined; };
    };

    render(<WorkbenchApp service={service} />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Your saved sign-in is temporarily unavailable"));
    expect(screen.getByRole("button", { name: "Retry session" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry saved session" }));
    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    expect(restoreAuth).toHaveBeenCalledTimes(2);
  });

  it("distinguishes unavailable host credentials and offers retry or fresh sign-in", async () => {
    const service = signedInService();
    const unavailable = { status: "error" as const, reason: "credential_unavailable" as const };
    let listener: ((state: ReturnType<typeof service.authState>) => void) | undefined;
    const signedIn = service.authState();
    service.authState = () => unavailable;
    service.subscribeAuth = next => { listener = next; return () => { listener = undefined; }; };
    const restoreAuth = vi.fn().mockResolvedValueOnce(unavailable).mockImplementationOnce(async () => { listener?.(signedIn); return signedIn; });
    service.restoreAuth = restoreAuth;
    render(<WorkbenchApp service={service} />);
    await screen.findByText("Your saved sign-in couldn’t be opened");
    expect(screen.getByText(/Check Obsidian’s Keychain settings/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in / register" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry saved sign-in" }));
    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    expect(restoreAuth).toHaveBeenCalledTimes(2);
  });

  it("opens the fixed-link anonymous demo in Single Fetch", () => {
    render(<WorkbenchApp />);

    expect(screen.getByRole("heading", { name: "Fetch from social media" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Public post URL" })).toHaveValue(SINGLE_DEMO_LINK);
    expect(screen.getByRole("textbox", { name: "Public post URL" })).toHaveAttribute("readonly");
    expect(within(screen.getByRole("tabpanel")).getByText(/Try this link for a demo preview/i)).toBeVisible();
    expect(screen.queryByLabelText("Folder")).not.toBeInTheDocument();
  });

  it("shows the demo preview after clicking Try this link while signed out", async () => {
    const service = signedInService();
    service.authState = () => ({ status: "signed_out" });
    service.restoreAuth = async () => ({ status: "signed_out" });
    const previewSingle = vi.fn(async () => ({
      post: {
        platform: "youtube", contentId: "agentlens-demo", canonicalUrl: DEMO_URL,
        title: "Server demo preview", text: "Demo content",
        author: { id: "demo", displayName: "Demo Creator" }, media: []
      },
      usage: { charged: false, units: 0, remaining: null }, demo: true
    }));
    service.previewSingle = previewSingle;
    render(<WorkbenchApp service={service} />);

    expect(screen.getByRole("heading", { name: "Try Your First Sync, Zero Setup Required" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Fetch demo" }));

    expect(await screen.findByRole("heading", { name: "Server demo preview" })).toBeVisible();
    expect(screen.getByLabelText("Rendered note")).toHaveTextContent("Demo content");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Try Your First Sync, Zero Setup Required" })).not.toBeInTheDocument();
    expect(previewSingle).toHaveBeenCalledWith(DEMO_URL);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Try Your First Sync, Zero Setup Required" })).toBeVisible();
  });

  it("uses the formal save plan and results flow for anonymous bulk demo pages", async () => {
    const service = signedInService();
    const sample = await service.fetchProfilePage("unused", null);
    service.authState = () => ({ status: "signed_out" });
    service.restoreAuth = async () => ({ status: "signed_out" });
    const fetchProfilePage = vi.fn()
      .mockResolvedValueOnce({ ...sample, content: [sample.content[0]], page: { cursor: "snapshot", hasMore: true, pageNumber: 1 } })
      .mockResolvedValueOnce({ ...sample, content: [sample.content[1]], page: { cursor: null, hasMore: false, pageNumber: 2 } });
    service.fetchProfilePage = fetchProfilePage;
    vi.mocked(service.savePrepared).mockImplementation(async entries => ({
      successes: entries.map(({ manifest }) => successfulSave(manifest)), failures: []
    }));
    render(<WorkbenchApp service={service} />);
    fireEvent.click(screen.getByRole("tab", { name: "Bulk Fetch" }));
    fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
    await screen.findByRole("button", { name: "Preview Post A" });
    expect(fetchProfilePage).toHaveBeenNthCalledWith(1, BULK_DEMO_LINK, null);
    fireEvent.click(screen.getByRole("button", { name: "Fetch more" }));
    await screen.findByRole("button", { name: "Preview Post B" });
    expect(fetchProfilePage).toHaveBeenNthCalledWith(2, BULK_DEMO_LINK, "snapshot");
    expect(screen.getByRole("button", { name: "Fetch more" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select visible" }));
    fireEvent.click(screen.getByRole("button", { name: "Review batch manifest" }));
    const saveButton = await screen.findByRole("button", { name: "Save 2 notes to vault" });
    expect(screen.queryByRole("dialog", { name: "Sign up to start free with real links" })).not.toBeInTheDocument();
    fireEvent.click(saveButton);
    expect(await screen.findByRole("dialog", { name: "Sign up to start free with real links" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Close save results" })).toBeVisible();
    expect(service.savePrepared).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ preview: expect.objectContaining({ demo: true }) })]),
      expect.any(Function)
    );
    expect(screen.queryByRole("dialog", { name: "Sign up to start free with real links" })).not.toBeInTheDocument();
  });

  it("uses the formal save plan before writing the single demo", async () => {
    const service = signedInService();
    service.authState = () => ({ status: "signed_out" });
    service.restoreAuth = async () => ({ status: "signed_out" });
    const sample = await service.previewSingle(DEMO_URL);
    vi.mocked(service.previewSingle).mockResolvedValue({ ...sample, demo: true });
    vi.mocked(service.savePrepared).mockImplementation(async entries => ({
      successes: entries.map(({ manifest }) => successfulSave(manifest)), failures: []
    }));
    render(<WorkbenchApp service={service} />);
    fireEvent.click(screen.getByRole("button", { name: "Fetch demo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(service.savePrepared).not.toHaveBeenCalled();
    const saveButton = await screen.findByRole("button", { name: "Save 1 notes to vault" });
    expect(screen.queryByRole("dialog", { name: "Sign up to start free with real links" })).not.toBeInTheDocument();
    fireEvent.click(saveButton);
    expect(await screen.findByRole("dialog", { name: "Sign up to start free with real links" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Close save results" })).toBeVisible();
    expect(service.savePrepared).toHaveBeenCalledTimes(1);
  });

  it.each(["single", "bulk"])("does not prompt for signup when the %s demo save fails", async workflow => {
    const service = signedInService();
    service.authState = () => ({ status: "signed_out" });
    service.restoreAuth = async () => ({ status: "signed_out" });
    const sample = await service.previewSingle(DEMO_URL);
    vi.mocked(service.previewSingle).mockResolvedValue({ ...sample, demo: true });
    vi.mocked(service.savePrepared).mockImplementation(async entries => ({
      successes: [], failures: entries.map(({ preview }) => ({ preview, error: "Demo save failed" }))
    }));
    render(<WorkbenchApp service={service} />);
    if (workflow === "bulk") {
      fireEvent.click(screen.getByRole("tab", { name: "Bulk Fetch" }));
      fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
      await screen.findByRole("button", { name: "Preview Post A" });
      fireEvent.click(screen.getByRole("checkbox", { name: "Select visible" }));
      fireEvent.click(screen.getByRole("button", { name: "Review batch manifest" }));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Fetch demo" }));
      fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    }
    fireEvent.click(await screen.findByRole("button", { name: /Save \d+ notes to vault/ }));
    expect(await screen.findByRole("button", { name: "Close save results" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Sign up to start free with real links" })).not.toBeInTheDocument();
  });

  it("shows the matching demo notice and signup action below the anonymous bulk input", async () => {
    render(<WorkbenchApp />);
    fireEvent.click(screen.getByRole("tab", { name: "Bulk Fetch" }));
    const input = screen.getByRole("textbox", { name: "Creator profile URL" });
    expect(input).toHaveAccessibleDescription("try this link for a demo preview, or sign up to start free with real links.");
    fireEvent.click(screen.getByRole("button", { name: "sign up" }));
    expect(await screen.findByRole("dialog", { name: "Sign up to start free with real links" })).toBeVisible();
  });

  it("keeps demo mode immutable even when a command supplies a URL", () => {
    render(<WorkbenchApp initialUrl="https://example.com/post/42" />);

    expect(screen.getByRole("textbox", { name: "Public post URL" })).toHaveValue(SINGLE_DEMO_LINK);
    expect(screen.getByRole("textbox", { name: "Public post URL" })).toHaveAttribute("readonly");
  });

  it("keeps workflows in separate tab panels", () => {
    render(<WorkbenchApp />);

    fireEvent.click(screen.getByRole("tab", { name: "Bulk Fetch" }));
    expect(screen.getByRole("textbox", { name: "Creator profile URL" })).toHaveValue(BULK_DEMO_LINK);
    expect(screen.getByRole("textbox", { name: "Creator profile URL" })).toHaveAttribute("readonly");
    expect(screen.getByRole("heading", { name: "Fetch from social media" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Bulk Fetch" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Auto-fetch" }));
    expect(screen.getByRole("heading", { name: "Auto-Fetch" })).toBeVisible();
    expect(screen.getByText(/automatically check for and import new posts/i)).toBeVisible();
  });

  it("uses roving keyboard focus and labelled panels for workflow tabs", () => {
    render(<WorkbenchApp />);
    const single = screen.getByRole("tab", { name: "Single Fetch" });
    const bulk = screen.getByRole("tab", { name: "Bulk Fetch" });

    expect(single).toHaveAttribute("tabindex", "0");
    expect(bulk).toHaveAttribute("tabindex", "-1");
    single.focus();
    fireEvent.keyDown(single, { key: "ArrowRight" });
    expect(bulk).toHaveFocus();
    expect(bulk).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", bulk.id);

    fireEvent.keyDown(bulk, { key: "Home" });
    expect(single).toHaveFocus();
    expect(single).toHaveAttribute("aria-selected", "true");
  });

  it("opens Auto-Fetch through read-only setup without reconciling scheduler state", async () => {
    const service = signedInService();
    const runScheduled = vi.fn();
    service.runScheduled = runScheduled;

    render(<WorkbenchApp initialTab="auto" service={service} />);

    expect(await screen.findByRole("heading", { name: "Auto-Fetch" })).toBeVisible();
    await waitFor(() => expect(screen.getByText(/automatically check for and import new posts/i)).toBeVisible());
    expect(runScheduled).not.toHaveBeenCalled();
  });

  it("keeps the workbench header free of a settings entry", () => {
    render(<WorkbenchApp />);

    expect(screen.queryByRole("button", { name: "Open AgentLens settings" })).not.toBeInTheDocument();
  });

  it("hides deferred Library Maintenance without fetching history", async () => {
    const service = signedInService();
    service.activity = vi.fn();
    render(<WorkbenchApp service={service} />);
    fireEvent.click(await screen.findByRole("button", {name:"Account menu"}));
    expect(screen.queryByRole("button", {name:"Library Maintenance"})).not.toBeInTheDocument();
    expect(service.activity).not.toHaveBeenCalled();
  });

  it("removes a legacy Device Code waiting state and returns to login", async () => {
    const service = signedInService();
    const authorization = {
      deviceCode: "device-secret",
      userCode: "ABCD-EFGH",
      verificationUri: "https://agentlens.example/device",
      expiresIn: 600,
      interval: 5
    };
    const authorizing = { status: "authorizing" as const, authorization, expiresAt: Date.now() + 300_000, nextPollAt: Date.now() + 60_000 };
    service.authState = () => authorizing;
    service.restoreAuth = async () => authorizing;
    render(<WorkbenchApp service={service} />);

    expect(await screen.findByLabelText(/^Password/)).toBeVisible();
    expect(screen.queryByText("ABCD-EFGH")).toBeNull();
    expect(screen.queryByRole("region", { name: "Device authorization" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check authorization" })).toBeNull();
  });

  it("returns to in-plugin login after denial without starting a device-code flow", async () => {
    const service = signedInService();
    const startSignIn = vi.fn(async () => ({ status: "error" as const, reason: "denied" as const }));
    service.authState = () => ({ status: "error", reason: "denied" });
    service.restoreAuth = async () => ({ status: "error", reason: "denied" });
    service.startSignIn = startSignIn;
    render(<WorkbenchApp service={service} />);

    expect(screen.getByRole("alert")).toHaveTextContent("previous code or session will not be reused");
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    await screen.findByLabelText(/^Password/);
    expect(startSignIn).not.toHaveBeenCalled();
  });

  it("opens the Google window during the click before requesting the device code", async () => {
    const service = signedInService();
    service.authState = () => ({ status: "signed_out" });
    service.restoreAuth = async () => ({ status: "signed_out" });
    let resolveAuthorization!: (value: Awaited<ReturnType<typeof service.startSignIn>>) => void;
    service.startSignIn = vi.fn(() => new Promise<Awaited<ReturnType<typeof service.startSignIn>>>(resolve => { resolveAuthorization = resolve; }));
    const replace = vi.fn();
    const popup = { location: { replace }, opener: window, closed: false, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    render(<WorkbenchApp service={service} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in / register" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(replace).not.toHaveBeenCalled();
    resolveAuthorization({ status: "authorizing", authorization: {
      deviceCode: "device-secret", userCode: "ABCD-EFGH", verificationUri: "https://agentlens.example/device",
      verificationUriComplete: "https://agentlens.example/device?code=ABCD-EFGH&provider=google", expiresIn: 600, interval: 5
    }, expiresAt: Date.now() + 600_000, nextPollAt: Date.now() + 5000, provider: "google" });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("https://agentlens.example/device?code=ABCD-EFGH&provider=google"));
    expect(popup.opener).toBeNull();
    open.mockRestore();
  });

  it("keeps Google browser sign-in on the existing login form without a workbench banner", async () => {
    const service = signedInService();
    const authorizing = { status: "authorizing" as const, provider: "google" as const,
      authorization: { deviceCode: "device-secret", userCode: "ABCD-EFGH", verificationUri: "https://agentlens.example/device", expiresIn: 600, interval: 5 },
      expiresAt: Date.now() + 300_000, nextPollAt: Date.now() + 60_000 };
    service.authState = () => authorizing;
    service.restoreAuth = async () => authorizing;
    render(<WorkbenchApp service={service} />);

    expect(await screen.findByRole("region", { name: "Sign in to your account" })).toBeVisible();
    expect(screen.getByText("Finish Google sign-in in your browser, then return to Obsidian. Sign-in will finish automatically.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Open Google sign-in again" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Waiting for Google…" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "Device authorization" })).not.toBeInTheDocument();
    expect(screen.queryByText("ABCD-EFGH")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
  });

  it("marks the registration Google button as sign-up", async () => {
    const service = signedInService();
    service.authState = () => ({ status: "signed_out" });
    service.restoreAuth = async () => ({ status: "signed_out" });
    service.startSignIn = vi.fn(async () => ({ status: "error" as const, reason: "denied" as const }));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      render(<WorkbenchApp service={service} />);
      fireEvent.click(within(screen.getByLabelText("Account status")).getByRole("button", { name: "Start Free" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign up with Google" }));
      await waitFor(() => expect(service.startSignIn).toHaveBeenCalledWith("google", "sign_up"));
    } finally {
      open.mockRestore();
    }
  });

  it("shows an expired Google attempt in the login form and offers a retry", async () => {
    const service = signedInService();
    const expired = { status: "error" as const, reason: "expired" as const, provider: "google" as const };
    service.authState = () => expired;
    service.restoreAuth = async () => expired;
    service.startSignIn = vi.fn(async () => expired);
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<WorkbenchApp service={service} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in could not be completed. Start again.");
    expect(screen.queryByRole("region", { name: "Device authorization" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try Google sign-in again" }));
    await waitFor(() => expect(service.startSignIn).toHaveBeenCalledWith("google", "sign_in"));
    open.mockRestore();
  });

  it("shows only the credential error in the login form", async () => {
    const service = signedInService();
    service.authState = () => ({ status: "signed_out" });
    service.restoreAuth = async () => ({ status: "signed_out" });
    service.signInWithEmail = vi.fn(async () => {
      throw new AgentLensError("auth_required", "The email address or password is incorrect", false, 401, undefined, "request-sensitive-1234567890");
    });
    render(<WorkbenchApp service={service} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in / register" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Email/ }), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: "wrong-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The email or password is incorrect. Check them and try again.");
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Request|Retry is not safe/);
  });

  it("returns an expired email connection to email sign-in", async () => {
    const service = signedInService();
    service.authState = () => ({ status: "error", reason: "expired", provider: "email" });
    service.restoreAuth = async () => ({ status: "error", reason: "expired", provider: "email" });
    service.signOut = vi.fn(async () => undefined);
    service.startSignIn = vi.fn();
    render(<WorkbenchApp service={service} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to email sign-in" }));
    await waitFor(() => expect(service.signOut).toHaveBeenCalledOnce());
    expect(await screen.findByRole("region", { name: "Sign in to your account" })).toBeVisible();
    expect(service.startSignIn).not.toHaveBeenCalled();
  });

  it("opens Google authorization in the system browser in the desktop host", async () => {
    const service = signedInService();
    service.authState = () => ({ status: "signed_out" });
    service.restoreAuth = async () => ({ status: "signed_out" });
    const url = "https://agentlens.example/device?code=ABCD-EFGH&provider=google";
    service.startSignIn = vi.fn(async () => ({ status: "authorizing" as const, authorization: {
      deviceCode: "device-secret", userCode: "ABCD-EFGH", verificationUri: "https://agentlens.example/device",
      verificationUriComplete: url, expiresIn: 600, interval: 5
    }, expiresAt: Date.now() + 600_000, nextPollAt: Date.now() + 5000, provider: "google" as const }));
    const openExternal = vi.fn(async () => undefined);
    vi.stubGlobal("require", (name: string) => name === "electron" ? { shell: { openExternal } } : undefined);
    const open = vi.spyOn(window, "open");
    try {
      render(<WorkbenchApp service={service} />);
      fireEvent.click(screen.getByRole("button", { name: "Sign in / register" }));
      fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
      await waitFor(() => expect(openExternal).toHaveBeenCalledExactlyOnceWith(url));
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("reparses and plans a new manual copy without exposing a copy button", async () => {
    const service = signedInService();
    const planPreview = vi.spyOn(service, "planPreview");
    service.savePrepared = vi.fn(async (entries: readonly PreparedSave[]) => ({
      successes: [successfulSave(entries[0]!.manifest)], failures: []
    }));
    render(<WorkbenchApp service={service} />);
    await within(screen.getByLabelText("Single Fetch supported platforms")).findByText("Reddit");
    fireEvent.change(screen.getByRole("textbox", { name: "Public post URL" }), { target: { value: "https://youtube.com/watch?v=post-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 notes to vault" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close save results" }));
    expect(screen.queryByRole("button", { name: "Save another copy" })).not.toBeInTheDocument();
    planPreview.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));

    await waitFor(() => expect(planPreview).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ saveAsCopy: true })));
    expect(service.previewSingle).toHaveBeenCalledTimes(2);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 notes to vault" }));
    await waitFor(() => expect(service.savePrepared).toHaveBeenCalledTimes(2));
  });

  it("extracts the link from pasted share text before previewing", async () => {
    const service = signedInService();
    render(<WorkbenchApp service={service} />);

    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    const input = screen.getByRole("textbox", { name: "Public post URL" });
    fireEvent.change(input, { target: { value: "全部学错！不要把in和on背成固定搭配！ https://v.douyin.com/4a9qaT01UYA/ 复制此链接，打开抖音搜索" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));

    await waitFor(() => expect(service.previewSingle).toHaveBeenCalledWith("https://v.douyin.com/4a9qaT01UYA/"));
  });

  it("drops a Single preview that resolves after the source URL changes", async () => {
    const service = signedInService();
    let resolvePreview!: (value: unknown) => void;
    const delayedPreview = new Promise((resolve) => { resolvePreview = resolve; });
    const previewSingle = vi.fn(() => delayedPreview);
    const planPreview = vi.spyOn(service, "planPreview");
    Object.assign(service as object, { previewSingle });
    render(<WorkbenchApp service={service} />);

    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    const input = screen.getByRole("textbox", { name: "Public post URL" });
    fireEvent.change(input, { target: { value: "https://youtube.com/watch?v=first" } });
    const fetchButton = screen.getByRole("button", { name: "Fetch preview" });
    await waitFor(() => expect(fetchButton).toBeEnabled());
    fireEvent.click(fetchButton);
    await waitFor(() => expect(previewSingle).toHaveBeenCalledWith("https://youtube.com/watch?v=first"));
    fireEvent.change(input, { target: { value: "https://youtube.com/watch?v=second" } });
    resolvePreview({
      post: {
        platform: "youtube", contentId: "first", canonicalUrl: "https://youtube.com/watch?v=first",
        title: "Stale first preview", text: "Old source", author: { id: "creator", displayName: "Creator" }, media: []
      },
      fetchId: "fetch-first", usage: { charged: true, units: 1, remaining: 98 }, usageRemaining: 98, demo: false
    });

    await waitFor(() => expect(fetchButton).toBeEnabled());
    expect(screen.queryByText("Stale first preview")).not.toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getByText("Paste a link to begin")).toBeVisible();
    expect(input).toHaveValue("https://youtube.com/watch?v=second");
    expect(planPreview).not.toHaveBeenCalled();
  });

  it("keeps the Single save destination stable while writing and shows the result", async () => {
    const service = signedInService();
    let resolveSave!: (value: BatchSaveResult) => void;
    let pendingPrepared: readonly PreparedSave[] = [];
    const delayedSave = new Promise<BatchSaveResult>((resolve) => { resolveSave = resolve; });
    vi.mocked(service.savePrepared).mockImplementation(async (prepared) => {
      pendingPrepared = prepared;
      return delayedSave;
    });
    render(<WorkbenchApp service={service} />);

    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    fireEvent.change(screen.getByRole("textbox", { name: "Public post URL" }), { target: { value: "https://youtube.com/watch?v=post-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 notes to vault" }));
    await waitFor(() => expect(service.savePrepared).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /^Saving$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to loaded posts" }));

    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "Research/Changed" } });
    const manifest = pendingPrepared[0]!.manifest;
    resolveSave({
      successes: [successfulSave(manifest)],
      failures: []
    });

    await waitFor(() => expect(screen.getByLabelText("Folder")).toHaveValue("AgentLens/Inbox"));
    expect(screen.queryByText(/Saved to .*post-a\.md/)).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Save" })).toBeVisible();
  });

  it("keeps save options out of the signed-out onboarding", () => {
    render(<WorkbenchApp />);
    expect(screen.getByRole("heading", { name: "Try Your First Sync, Zero Setup Required" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("keeps save options out of the signed-in empty capture state", async () => {
    render(<WorkbenchApp service={signedInService()} />);
    expect(await screen.findByRole("heading", { name: "Paste a link to begin" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Try Your First Sync, Zero Setup Required" })).not.toBeInTheDocument();
  });

  it("keeps Bulk filtering and preview while save settings stay in the main workflow", async () => {
    render(<WorkbenchApp initialTab="bulk" service={signedInService()} />);

    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Creator profile URL" }), { target: { value: "https://youtube.com/@creator" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
    expect(await screen.findByText("Post A")).toBeVisible();
    expect(screen.getByLabelText("Text-only post").querySelector("img.agentlens-default-media-cover")).not.toBeNull();
    fireEvent.click(screen.getByText("More filters"));
    expect(screen.getByText(/1 page\(s\) fetched · 1 credit\(s\) charged · 98 remaining/)).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Filter by platform" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Only new notes" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Only with media" }));
    expect(screen.getByRole("checkbox", { name: "Select Post A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Post B" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Preview Post A" }));
    expect(screen.getByRole("dialog", { name: "Preview" })).toBeVisible();
    expect(screen.queryByText("Save settings and technical details")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "This post folder" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview Post B" }));
    expect(screen.getByRole("dialog", { name: "Preview" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("drops a Bulk page that resolves after the creator profile URL changes", async () => {
    const service = signedInService();
    let resolvePage!: (value: unknown) => void;
    const delayedPage = new Promise((resolve) => { resolvePage = resolve; });
    const fetchProfilePage = vi.fn(() => delayedPage);
    Object.assign(service as object, { fetchProfilePage });
    render(<WorkbenchApp initialTab="bulk" service={service} />);

    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    const input = screen.getByRole("textbox", { name: "Creator profile URL" });
    fireEvent.change(input, { target: { value: "https://youtube.com/@first" } });
    const fetchButton = screen.getByRole("button", { name: "Fetch page" });
    await waitFor(() => expect(fetchButton).toBeEnabled());
    fireEvent.click(fetchButton);
    await waitFor(() => expect(fetchProfilePage).toHaveBeenCalledWith("https://youtube.com/@first", null));
    fireEvent.change(input, { target: { value: "https://youtube.com/@second" } });
    resolvePage({
      fetchId: "fetch-first", mode: "profile_page", platform: "youtube",
      content: [{
        platform: "youtube", contentId: "stale-post", canonicalUrl: "https://youtube.com/watch?v=stale",
        title: "Stale creator post", text: "Old creator", author: { id: "first", displayName: "First creator" }, media: []
      }],
      page: { cursor: "stale.cursor", hasMore: true, pageNumber: 1 },
      usage: { charged: true, units: 1, remaining: 98 }
    });

    await waitFor(() => expect(fetchButton).toBeEnabled());
    expect(screen.queryByText("Stale creator post")).not.toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).getByText("Paste a link to begin")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Fetch more/ })).not.toBeInTheDocument();
    expect(input).toHaveValue("https://youtube.com/@second");
  });

  it("isolates an in-flight Bulk cursor page when switching creator profiles", async () => {
    const service = signedInService();
    let resolveMore!: (value: unknown) => void;
    const delayedMore = new Promise((resolve) => { resolveMore = resolve; });
    const page = (contentId: string, title: string, cursor: string | null, pageNumber: number) => ({
      fetchId: `fetch-${pageNumber}`, mode: "profile_page", platform: "youtube",
      content: [{
        platform: "youtube", contentId, canonicalUrl: `https://youtube.com/watch?v=${contentId}`,
        title, text: title, author: { id: "first", displayName: "First creator" }, media: []
      }],
      page: { cursor, hasMore: cursor !== null, pageNumber },
      usage: { charged: true, units: 1, remaining: 99 - pageNumber }
    });
    const fetchProfilePage = vi.fn()
      .mockResolvedValueOnce(page("first-page", "First creator page", "cursor-2", 1))
      .mockImplementationOnce(() => delayedMore);
    Object.assign(service as object, { fetchProfilePage });
    render(<WorkbenchApp initialTab="bulk" service={service} />);

    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    const input = screen.getByRole("textbox", { name: "Creator profile URL" });
    fireEvent.change(input, { target: { value: "https://youtube.com/@first" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
    expect((await screen.findAllByText("First creator page")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Fetch more/ }));
    await waitFor(() => expect(fetchProfilePage).toHaveBeenLastCalledWith("https://youtube.com/@first", "cursor-2"));
    fireEvent.change(input, { target: { value: "https://youtube.com/@second" } });
    resolveMore(page("second-page", "Stale second page", null, 2));

    await waitFor(() => expect(screen.getByRole("button", { name: "Fetch page" })).toBeEnabled());
    expect(screen.queryAllByText("First creator page")).toHaveLength(0);
    expect(screen.queryAllByText("Stale second page")).toHaveLength(0);
    expect(within(screen.getByRole("tabpanel")).getByText("Paste a link to begin")).toBeVisible();
    expect(input).toHaveValue("https://youtube.com/@second");
  });

  it("drops an in-flight Bulk save result after switching creator profiles", async () => {
    const service = signedInService();
    let resolveSave!: (value: BatchSaveResult) => void;
    let pendingPrepared: readonly PreparedSave[] = [];
    const delayedSave = new Promise<BatchSaveResult>((resolve) => { resolveSave = resolve; });
    vi.mocked(service.savePrepared).mockImplementation(async (prepared) => {
      pendingPrepared = prepared;
      return delayedSave;
    });
    render(<WorkbenchApp initialTab="bulk" service={service} />);

    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    const input = await screen.findByRole("textbox", { name: "Creator profile URL" });
    fireEvent.change(input, { target: { value: "https://youtube.com/@first" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
    await screen.findByText("Post A");
    fireEvent.click(screen.getByRole("button", { name: "Only with media" }));
    fireEvent.click(screen.getByRole("button", { name: "Review batch manifest" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 notes to vault" }));
    await waitFor(() => expect(service.savePrepared).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: /^Saving$/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Back to loaded posts" }));
    const nextInput = screen.getByRole("textbox", { name: "Creator profile URL" });
    fireEvent.change(nextInput, { target: { value: "https://youtube.com/@second" } });
    const manifest = pendingPrepared[0]!.manifest;
    resolveSave({
      successes: [successfulSave(manifest)],
      failures: []
    });
    fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));

    await screen.findByText("Post A");
    expect(nextInput).toHaveValue("https://youtube.com/@second");
    expect(screen.queryByText(/1 saved; 0 already saved \(0 partial\); 0 failed/)).not.toBeInTheDocument();
  });

  it("retries Bulk partial media without duplicating the successful note result", async () => {
    const service = signedInService();
    const resultFor = (prepared: readonly PreparedSave[], completion: "partial" | "complete"): BatchSaveResult => ({
      successes: prepared.map(({ manifest }) => successfulSave(manifest, completion, [
        { mediaId: "media-a", path: "attachments/media-a.mp4", status: completion === "partial" ? "failed" : "saved" }
      ])),
      failures: []
    });
    vi.mocked(service.savePrepared)
      .mockImplementationOnce(async (prepared) => resultFor(prepared, "partial"))
      .mockImplementationOnce(async (prepared) => resultFor(prepared, "complete"));
    render(<WorkbenchApp initialTab="bulk" service={service} />);
    await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Creator profile URL" }), { target: { value: "https://youtube.com/@creator" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
    await screen.findByText("Post A");
    fireEvent.click(screen.getByRole("button", { name: "Only with media" }));
    fireEvent.click(screen.getByRole("button", { name: "Review batch manifest" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 notes to vault" }));

    fireEvent.click(await screen.findByRole("button", { name: "Retry failed and partial notes" }));
    await waitFor(() => expect(screen.getByText(/1 saved; 0 already saved \(0 partial\); 0 failed/)).toBeVisible());
    expect(service.savePrepared).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Retry failed and partial notes" })).not.toBeInTheDocument();
  });

  it("shows a Single save plan before writing and then shows results", async () => {
    const service = signedInService();
    vi.mocked(service.savePrepared).mockImplementation(async prepared => ({ successes: prepared.map(({manifest}) => successfulSave(manifest)), failures: [] }));
    render(<WorkbenchApp service={service} />);
    await within(screen.getByLabelText("Single Fetch supported platforms")).findByText("Reddit");
    fireEvent.change(screen.getByRole("textbox", { name: "Public post URL" }), { target: { value: "https://youtube.com/watch?v=post-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(service.savePrepared).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save 1 notes to vault" }));
    await waitFor(() => expect(service.savePrepared).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Close save results" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Confirm Vault write" })).not.toBeInTheDocument();
  });

  it("replans an existing Single note before retrying failed media", async () => {
    const service = signedInService();
    vi.mocked(service.savePrepared).mockImplementationOnce(async (prepared) => ({
      successes: prepared.map(({ manifest }) => successfulSave(manifest, "partial", [
        { mediaId: "media-a", path: "attachments/media-a.mp4", status: "failed" }
      ])),
      failures: []
    }));
    render(<WorkbenchApp service={service} />);
    await within(screen.getByLabelText("Single Fetch supported platforms")).findByText("Reddit");
    fireEvent.change(screen.getByRole("textbox", { name: "Public post URL" }), { target: { value: "https://youtube.com/watch?v=post-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    fireEvent.click(await screen.findByRole("button", { name: "Save 1 notes to vault" }));
    await screen.findByRole("button", { name: "Retry failed and partial notes" });
    const priorManifest = await service.planPreview(
      { post: {
        platform: "youtube", contentId: "post-a", canonicalUrl: "https://youtube.com/watch?v=post-a",
        title: "Post A", text: "Research A", author: { id: "creator-1", displayName: "Creator", handle: "creator" }, media: []
      }, fetchId: "fetch-single", usageRemaining: null, demo: false }
    );
    const replan = vi.fn(async () => ({ ...priorManifest, action: "update" as const, reason: "Existing note with failed media" }));
    service.planPreview = replan;

    fireEvent.click(await screen.findByRole("button", { name: "Retry failed and partial notes" }));
    expect(replan).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(service.savePrepared).toHaveBeenCalledTimes(2));
  });

  it("coalesces a rapid double-click into one Single fetch action", async () => {
    const service = signedInService();
    let resolvePreview!: (value: PreviewResult) => void;
    const pending = new Promise<PreviewResult>((resolve) => { resolvePreview = resolve; });
    service.previewSingle = vi.fn(() => pending);
    render(<WorkbenchApp service={service} />);
    await within(screen.getByLabelText("Single Fetch supported platforms")).findByText("Reddit");
    fireEvent.change(screen.getByRole("textbox", { name: "Public post URL" }), { target: { value: "https://youtube.com/watch?v=post-a" } });
    const fetch = screen.getByRole("button", { name: "Fetch preview" });

    fireEvent.click(fetch);
    fireEvent.click(fetch);
    expect(service.previewSingle).toHaveBeenCalledTimes(1);
    resolvePreview({ post: {
      platform: "youtube", contentId: "post-a", canonicalUrl: "https://youtube.com/watch?v=post-a",
      title: "Post A", text: "Research A", author: { id: "creator-1", displayName: "Creator", handle: "creator" }, media: []
    }, fetchId: "fetch-single", usage: { charged: true, units: 1, remaining: 98 }, usageRemaining: 98, demo: false });
    await screen.findByRole("button", { name: "Save" });
  });

  it("shows retry safety without a partial request id for live action errors", async () => {
    const service = signedInService();
    service.previewSingle = vi.fn(async () => {
      throw new AgentLensError("provider_unavailable", "Provider is temporarily unavailable.", true, 503, undefined, "request-sensitive-1234567890");
    });
    render(<WorkbenchApp service={service} />);
    await within(screen.getByLabelText("Single Fetch supported platforms")).findByText("Reddit");
    fireEvent.change(screen.getByRole("textbox", { name: "Public post URL" }), { target: { value: "https://youtube.com/watch?v=post-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Try again");
    expect(alert).not.toHaveTextContent("Request request-");
    expect(alert).not.toHaveTextContent("request-sensitive-1234567890");
  });

  it("keeps the last account snapshot visible and labels it stale after refresh fails", async () => {
    const service = signedInService();
    const initialAccount = await service.account();
    service.account = vi.fn()
      .mockResolvedValueOnce(initialAccount)
      .mockRejectedValueOnce(new AgentLensError("network_unavailable", "Could not refresh account.", true, undefined, undefined, "account-request-1"));
    render(<WorkbenchApp service={service} />);
    fireEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    await screen.findByRole("button", { name: "Billing & Usage" });

    fireEvent.click(screen.getByRole("button", { name: "Refresh account" }));
    expect(await screen.findByText(/stale snapshot/i)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Check your connection and try again");
    expect(screen.getByText("99 / 100")).toBeVisible();
  });

  it("fails closed for an obsolete plugin while preserving account and release links", async () => {
    const service = signedInService();
    const baseCapabilities = await service.capabilities();
    service.capabilities = async () => ({
      ...baseCapabilities,
      minimumPluginVersion: "0.2.0",
      latestPluginVersion: "0.2.1"
    });
    render(<WorkbenchApp service={service} />);

    expect(await screen.findByText(/Update AgentLens Social Importer to version 0.2.0 or newer/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Fetch preview" })).toBeDisabled();
    fireEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("button", { name: "Billing & Usage" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Release notes" })).toBeVisible();
  });

  it("switches Single and Bulk without prompting and preserves the Single draft", async () => {
    render(<WorkbenchApp service={signedInService()} />);
    await within(screen.getByLabelText("Single Fetch supported platforms")).findByText("Reddit");
    fireEvent.change(screen.getByRole("textbox", { name: "Public post URL" }), { target: { value: "https://youtube.com/watch?v=post-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("tab", { name: "Bulk Fetch" }));
    expect(screen.queryByRole("dialog", { name: "Unsaved draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Creator profile URL" })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Single Fetch" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Public post URL" })).toHaveValue("https://youtube.com/watch?v=post-a");
  });

  it("shows operation-specific capability marks in Auto-Fetch", async () => {
    render(<WorkbenchApp initialTab="auto" service={signedInService()} />);
    const platforms = await screen.findByLabelText("Auto-Fetch supported platforms");
    await waitFor(() => expect(platforms).toHaveTextContent("YouTube"));
    expect(platforms).toHaveTextContent("Reddit · subreddits only");
  });

  it("keeps the platform catalog through token rotation and clears it on sign-out", async () => {
    const service = signedInService();
    let listener: ((state: ReturnType<typeof service.authState>) => void) | undefined;
    service.subscribeAuth = next => { listener = next; return () => { listener = undefined; }; };
    const getCapabilities = vi.spyOn(service, "capabilities");
    render(<WorkbenchApp service={service} />);
    await within(screen.getByLabelText("Single Fetch supported platforms")).findByText("Reddit");
    const calls = getCapabilities.mock.calls.length;
    await act(async () => { listener?.({status: "signed_in", accessToken: "rotated", accessTokenExpiresAt: Date.now() + 60000}); });
    expect(getCapabilities).toHaveBeenCalledTimes(calls);
    expect(within(screen.getByLabelText("Single Fetch supported platforms")).getByText("Reddit")).toBeInTheDocument();
    await act(async () => { listener?.({status: "signed_out"}); });
    expect(within(screen.getByLabelText("Single Fetch supported platforms")).queryByText("Reddit")).not.toBeInTheDocument();
  });

  it("renders capability-driven platform availability for all three workflows", async () => {
    render(<WorkbenchApp service={signedInService()} />);

    const single = await screen.findByLabelText("Single Fetch supported platforms");
    await waitFor(() => expect(single).toHaveTextContent("Reddit"));
    expect(single).toHaveTextContent("YouTube");
    expect(single).toHaveTextContent("Reddit");
    expect(single).not.toHaveTextContent("subreddits only");

    fireEvent.click(screen.getByRole("tab", { name: "Bulk Fetch" }));
    const bulk = screen.getByLabelText("Bulk Fetch supported platforms");
    expect(bulk).toHaveTextContent("YouTube");
    expect(bulk).toHaveTextContent("Reddit · subreddits only");

    fireEvent.click(screen.getByRole("button", { name: "Auto-fetch" }));
    const auto = screen.getByLabelText("Auto-Fetch supported platforms");
    expect(auto).toHaveTextContent("YouTube");
    expect(auto).toHaveTextContent("Reddit · subreddits only");
  });

  it("drives Auto-Fetch action labels and availability only from server-returned job state", async () => {
    const service = signedInService();
    const creators = [
      creator(),
      creator({ creatorId: "creator-paused", displayName: "Paused Creator", autoFetchEnabled: false, schedulerState: "paused" }),
      creator({ creatorId: "creator-running", displayName: "Running Creator", activeJobId: "job-1", activeJobTrigger: "catch_up", schedulerState: "catch_up_running" }),
      creator({ creatorId: "creator-quota", displayName: "Quota Creator", schedulerState: "quota_blocked" })
    ];
    service.autoFetchSetup = async () => ({
      settings: { homeTimezone: "Asia/Shanghai", confirmed: true }, creators
    });
    render(<WorkbenchApp initialTab="auto" service={service} />);

    const scheduled = (await screen.findByText("Scheduled Creator")).closest("article")!;
    expect(within(scheduled).getByRole("button", { name: "Check now" })).toBeEnabled();
    expect(within(scheduled).getByRole("button", { name: "Pause future checks" })).toBeEnabled();

    const paused = screen.getByText("Paused Creator").closest("article")!;
    expect(within(paused).queryByRole("button", { name: "Check now" })).not.toBeInTheDocument();
    expect(within(paused).getByRole("button", { name: "Resume on original cadence" })).toBeEnabled();

    const running = screen.getByText("Running Creator").closest("article")!;
    expect(within(running).queryByRole("button", { name: "Running catch_up" })).not.toBeInTheDocument();
    expect(within(running).getByRole("button", { name: "Pause future checks" })).toBeDisabled();

    const quota = screen.getByText("Quota Creator").closest("article")!;
    expect(within(quota).getByRole("button", { name: "Check now" })).toBeDisabled();
    expect(within(quota).getByRole("button", { name: "Pause future checks" })).toBeDisabled();
  });

  it("offers a weekly Creator schedule and caps it at twelve weeks", async () => {
    const service = signedInService();
    service.autoFetchSetup = async () => ({
      settings: { homeTimezone: "Asia/Shanghai", confirmed: true }, creators: [creator()]
    });
    render(<WorkbenchApp initialTab="auto" service={service} />);

    const row = (await screen.findByText("Scheduled Creator")).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Auto-Fetch New Posts" });
    const every = within(editor).getByLabelText("Frequency") as HTMLSelectElement;
    fireEvent.change(every, { target: { value: "168" } });
    fireEvent.change(within(editor).getByLabelText("Unit"), { target: { value: "week" } });

    expect(within(editor).getByRole("option", { name: "Weeks" })).toBeVisible();
    expect(every.value).toBe("12");
  });

  it("does not report an empty Vault when Auto Fetch setup fails and retries the full setup", async () => {
    const service = signedInService();
    const autoFetchSetup = vi.fn().mockRejectedValueOnce(new Error("Setup unavailable"))
      .mockResolvedValueOnce({ settings: { homeTimezone: "UTC", confirmed: true }, creators: [] });
    Object.assign(service, { autoFetchSetup });
    render(<WorkbenchApp initialTab="auto" service={service} />);
    await screen.findByText("Unable to load creators.");
    expect(screen.queryByText("No creators followed in this Vault.")).not.toBeInTheDocument();
    expect(screen.queryByText("0 of 0 creators")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add creator" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading creators" }));
    expect(await screen.findByText("No creators followed in this Vault.")).toBeVisible();
    expect(screen.getByText("0 of 0 creators")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add creator" })).toBeEnabled();
    expect(autoFetchSetup).toHaveBeenCalledTimes(2);
  });

  it("opens account follows on demand separately from the current Vault creator list", async () => {
    const service = signedInService();
    const accountFollows = vi.fn(async () => [{ followId: "remote", configRevision: 2,
      creator: { platform: "youtube", displayName: "Account-only Creator", handle: null, profileUrl: "https://youtube.com/@remote" },
      frequency: { every: 2, unit: "hour" as const }, autoFetchEnabled: false }]);
    Object.assign(service, { accountFollows });
    render(<WorkbenchApp initialTab="auto" service={service} />);
    fireEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    const button = await screen.findByRole("button", { name: "View account follows" });
    expect(accountFollows).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(await screen.findByText("Account-only Creator")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByText("Account-only Creator")).not.toBeInTheDocument();
    expect(screen.getByText("No creators followed in this Vault.")).toBeVisible();
  });

  it("updates only the matching Vault card after account-menu unfollow succeeds", async () => {
    const service = signedInService();
    const selected = creator({ followId: "account-follow" });
    const other = creator({ creatorId: "other", followId: "other-follow", displayName: "Other creator" });
    const unfollowAccount = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(undefined);
    Object.assign(service, {
      autoFetchSetup: async () => ({ settings: { homeTimezone: "UTC", confirmed: true }, creators: [selected, other] }),
      accountFollows: async () => [{ followId: "account-follow", configRevision: 1,
        creator: { platform: "youtube", displayName: "Account creator", handle: null, profileUrl: selected.profileUrl },
        frequency: { every: 1, unit: "hour" }, autoFetchEnabled: true }],
      unfollowAccount
    });
    render(<WorkbenchApp initialTab="auto" service={service} />);
    await screen.findByText("Scheduled Creator");
    fireEvent.click(await screen.findByRole("button", { name: "Account menu" }));
    fireEvent.click(await screen.findByRole("button", { name: "View account follows" }));
    fireEvent.click(await screen.findByRole("button", { name: "Unfollow Account creator across plugins" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm account unfollow" }));
    await screen.findByText(/We couldn’t confirm whether this creator was unfollowed/);
    expect(screen.getByText("Scheduled Creator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry account follows" }));
    const remove = await screen.findByRole("button", { name: "Unfollow Account creator across plugins" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Confirm account unfollow" }));
    await screen.findByText("No account follows.");
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByText("Scheduled Creator")).not.toBeInTheDocument();
    expect(screen.getByText("Other creator")).toBeVisible();
    expect(unfollowAccount).toHaveBeenNthCalledWith(2, "account-follow");
  });

  it("shows Creator save telemetry and retries the existing run without a manual check", async () => {
    const service = signedInService();
    const runCreatorNow = vi.fn(async () => ({ leases: 1, pages: 1, saved: 0, failed: 0, skipped: null }));
    const retryCreator = vi.fn(async () => ({ leases: 1, pages: 1, saved: 3, failed: 0, skipped: null }));
    Object.assign(service as object, {
      runCreatorNow,
      retryCreator,
      autoFetchSetup: async () => ({
        settings: { homeTimezone: "Asia/Shanghai", confirmed: true },
        creators: [creator({
          schedulerState: "retry_pending",
          activeJobId: "retry-job-1",
          retryAt: "2026-09-04T03:00:00Z",
          lastSavedAt: "2026-09-04T01:00:00Z",
          lastSavedCount: 3,
          lastSavedFetchRunId: "run-1",
          importedCount: 9
        })]
      })
    });
    render(<WorkbenchApp initialTab="auto" service={service} />);

    const row = (await screen.findByText("Scheduled Creator")).closest("article")!;
    expect(within(row).getByText("Last successful check")).toBeVisible();
    expect(within(row).getByText("Next check at")).toBeVisible();
    expect(within(row).getByText("Last saved")).toBeVisible();
    expect(within(row).getByText("Last saved at")).toBeVisible();
    expect(within(row).getByTitle("Run run-1")).toHaveTextContent("3");
    expect(within(row).getByText("9")).toBeVisible();
    expect(within(row).getByText(/Retry at:/)).toBeVisible();
    fireEvent.click(within(row).getByRole("button", { name: "Retry now" }));

    await waitFor(() => expect(retryCreator).toHaveBeenCalledWith(expect.objectContaining({ creatorId: "creator-1" })));
    expect(runCreatorNow).not.toHaveBeenCalled();
  });

  it("requires server schedule preview and explicit confirmation for edit and delete actions", async () => {
    const service = signedInService();
    const original = creator();
    const updated = creator({ timezone: "Asia/Tokyo", nextCheckAt: "2026-08-20T12:00:00Z" });
    service.autoFetchSetup = async () => ({
      settings: { homeTimezone: "Asia/Shanghai", confirmed: true }, creators: [original]
    });
    const previewCreatorSettings = vi.fn(async () => ({
      oldTimezone: "Asia/Shanghai",
      newTimezone: "Asia/Tokyo",
      oldNextCheckAt: "2026-08-20T12:00:00Z",
      newNextCheckAt: "2026-08-20T12:00:00Z",
      willRunImmediately: false,
      previewToken: "preview-token-1"
    }));
    const updateCreatorSettings = vi.fn(async () => updated);
    const deleteCreator = vi.fn(async () => undefined);
    Object.assign(service as object, { previewCreatorSettings, updateCreatorSettings, deleteCreator });
    render(<WorkbenchApp initialTab="auto" service={service} />);

    const row = (await screen.findByText("Scheduled Creator")).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Auto-Fetch New Posts" });
    fireEvent.change(within(editor).getByLabelText("Timezone"), { target: { value: "Asia/Tokyo" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Review changes" }));

    await waitFor(() => expect(previewCreatorSettings).toHaveBeenCalledTimes(1));
    expect(updateCreatorSettings).not.toHaveBeenCalled();
    expect(within(editor).getByText(/2026-08-20T12:00:00Z → 2026-08-20T12:00:00Z/)).toBeVisible();
    fireEvent.click(within(editor).getByRole("button", { name: "Confirm changes" }));
    await waitFor(() => expect(updateCreatorSettings).toHaveBeenCalledWith(
      "creator-1",
      expect.objectContaining({ timezone: "Asia/Tokyo" }),
      "preview-token-1"
    ));

    const updatedRow = screen.getByText("Scheduled Creator").closest("article")!;
    fireEvent.click(within(updatedRow).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(deleteCreator).not.toHaveBeenCalled();
    expect(within(screen.getByRole("dialog", { name: "Remove this creator from Auto-Fetch?" })).getByText(/Obsidian files and AgentLens history will be retained/)).toBeVisible();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove this creator from Auto-Fetch?" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deleteCreator).toHaveBeenCalledWith("creator-1"));
    expect(screen.queryByText("Scheduled Creator")).not.toBeInTheDocument();
  });

  it.each([true, false])("uses the account grant for minute frequency (granted=%s)", async (granted) => {
    const service = signedInService();
    service.autoFetchSetup = async () => ({ settings: { homeTimezone: "UTC", confirmed: true },
      creators: [creator()], autoFetchCapabilities: { minuteFrequencyAvailable: granted,
        minuteFrequencyMaxEvery: 7, minuteCreatorLimit: 10, minuteCreatorUsed: 0 } });
    render(<WorkbenchApp initialTab="auto" service={service} />);
    fireEvent.click(within((await screen.findByText("Scheduled Creator")).closest("article")!).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Auto-Fetch New Posts" });
    const unit = within(editor).getByLabelText("Unit");
    if (!granted) {
      expect(within(unit).queryByRole("option", { name: "Minutes" })).not.toBeInTheDocument();
    } else {
      fireEvent.change(unit, { target: { value: "minute" } });
      expect(within(editor).getByLabelText("Frequency").querySelectorAll("option")).toHaveLength(7);
      expect(unit).toHaveValue("minute");
    }
  });

  it("blocks allocating an extra minute-frequency creator when account capacity is full", async () => {
    const service = signedInService();
    service.autoFetchSetup = async () => ({ settings: { homeTimezone: "UTC", confirmed: true }, creators: [creator()],
      autoFetchCapabilities: { minuteFrequencyAvailable: true, minuteFrequencyMaxEvery: 59, minuteCreatorLimit: 10, minuteCreatorUsed: 10 } });
    const preview = vi.fn();
    service.previewCreatorSettings = preview;
    render(<WorkbenchApp initialTab="auto" service={service} />);
    fireEvent.click(within((await screen.findByText("Scheduled Creator")).closest("article")!).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Auto-Fetch New Posts" });
    fireEvent.change(within(editor).getByLabelText("Unit"), { target: { value: "minute" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Review changes" }));
    await waitFor(() => expect(within(editor).getByRole("alert")).toHaveTextContent("limit for this interval"));
    expect(preview).not.toHaveBeenCalled();
  });

  it("keeps a revoked minute schedule visible but blocks resubmitting it until changed", async () => {
    const service = signedInService();
    service.autoFetchSetup = async () => ({ settings: { homeTimezone: "UTC", confirmed: true },
      creators: [creator({ frequency: { every: 3, unit: "minute" } })],
      autoFetchCapabilities: { minuteFrequencyAvailable: false, minuteFrequencyMaxEvery: 59, minuteCreatorLimit: 10, minuteCreatorUsed: 0 } });
    const preview = vi.fn();
    service.previewCreatorSettings = preview;
    render(<WorkbenchApp initialTab="auto" service={service} />);
    fireEvent.click(within((await screen.findByText("Scheduled Creator")).closest("article")!).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Auto-Fetch New Posts" });
    expect(within(editor).getByLabelText("Unit")).toHaveValue("minute");
    fireEvent.click(within(editor).getByRole("button", { name: "Review changes" }));
    await waitFor(() => expect(within(editor).getByRole("alert")).toHaveTextContent("This interval isn’t available for your account"));
    expect(preview).not.toHaveBeenCalled();
  });

  it("drops an Auto settings preview that resolves after the draft changes", async () => {
    const service = signedInService();
    service.autoFetchSetup = async () => ({
      settings: { homeTimezone: "Asia/Shanghai", confirmed: true }, creators: [creator()]
    });
    let resolvePreview!: (value: unknown) => void;
    const delayedPreview = new Promise((resolve) => { resolvePreview = resolve; });
    const previewCreatorSettings = vi.fn(() => delayedPreview);
    Object.assign(service as object, { previewCreatorSettings });
    render(<WorkbenchApp initialTab="auto" service={service} />);

    const row = (await screen.findByText("Scheduled Creator")).closest("article")!;
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("dialog", { name: "Auto-Fetch New Posts" });
    fireEvent.click(within(editor).getByRole("button", { name: "Review changes" }));
    await waitFor(() => expect(previewCreatorSettings).toHaveBeenCalledTimes(1));
    fireEvent.change(within(editor).getByLabelText("Timezone"), { target: { value: "Asia/Tokyo" } });
    resolvePreview({
      oldTimezone: "Asia/Shanghai", newTimezone: "Asia/Shanghai",
      oldNextCheckAt: "2026-08-20T12:00:00Z", newNextCheckAt: "2026-08-20T12:00:00Z",
      willRunImmediately: false, previewToken: "stale-preview-token"
    });

    await waitFor(() => expect(within(editor).getByRole("button", { name: "Review changes" })).toBeEnabled());
    expect(within(editor).queryByRole("button", { name: "Confirm changes" })).not.toBeInTheDocument();
    expect(within(editor).getByLabelText("Timezone")).toHaveValue("Asia/Tokyo");
  });

  it("drops a creator parse response that resolves after the profile URL changes", async () => {
    const service = signedInService();
    let resolveParse!: (value: unknown) => void;
    const delayedParse = new Promise((resolve) => { resolveParse = resolve; });
    const parseCreator = vi.fn(() => delayedParse);
    Object.assign(service as object, { parseCreator });
    render(<WorkbenchApp initialTab="auto" service={service} />);

    const addCreator = await screen.findByRole("button", { name: "+ Add creator" });
    await waitFor(() => expect(addCreator).toBeEnabled());
    fireEvent.click(addCreator);
    const input = await screen.findByRole("textbox", { name: "Creator profile URL" });
    fireEvent.change(input, { target: { value: "https://youtube.com/@first" } });
    const parseButton = screen.getByRole("button", { name: "Parse creator" });
    await waitFor(() => expect(parseButton).toBeEnabled());
    fireEvent.click(parseButton);
    await waitFor(() => expect(parseCreator).toHaveBeenCalledWith("https://youtube.com/@first"));
    fireEvent.change(input, { target: { value: "https://youtube.com/@second" } });
    resolveParse({
      creator: { creatorId: "youtube:first", platform: "youtube", profileUrl: "https://youtube.com/@first", displayName: "First creator" },
      creatorToken: "stale-token",
      creatorTokenExpiresAt: "2026-08-20T14:00:00Z"
    });

    await waitFor(() => expect(parseButton).toBeEnabled());
    expect(screen.queryByText("First creator")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow creator" })).not.toBeInTheDocument();
    expect(input).toHaveValue("https://youtube.com/@second");
  });

  it("re-follows a deleted creator as a new monitoring instance without implicit history import", async () => {
    const service = signedInService();
    const original = creator({ creatorId: "creator-old" });
    const replacement = creator({ creatorId: "creator-new" });
    service.importCreatorBaseline = vi.fn(async () => ({ successes: [], failures: [{
      preview: { demo: false, post: { platform: "youtube", contentId: "failed", canonicalUrl: "https://youtube.com/watch?v=failed", text: "failed", author: { id: "creator", displayName: "Creator" }, media: [] } },
      error: "Vault disk full"
    }] }));
    service.autoFetchSetup = async () => ({
      settings: { homeTimezone: "Asia/Shanghai", confirmed: true }, creators: [original]
    });
    const deleteCreator = vi.fn(async () => undefined);
    const parseCreator = vi.fn(async () => ({
      creator: {
        creatorId: "youtube:creator",
        platform: "youtube",
        profileUrl: original.profileUrl,
        displayName: original.displayName
      },
      creatorToken: "creator-token",
      creatorTokenExpiresAt: "2026-08-20T14:00:00Z"
    }));
    const followCreator = vi.fn(async (_input: Parameters<AgentLensWorkbenchPort["followCreator"]>[0]) => replacement);
    Object.assign(service as object, { deleteCreator, parseCreator, followCreator });
    render(<WorkbenchApp initialTab="auto" service={service} />);

    const oldRow = (await screen.findByText("Scheduled Creator")).closest("article")!;
    fireEvent.click(within(oldRow).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Remove this creator from Auto-Fetch?" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deleteCreator).toHaveBeenCalledWith("creator-old"));
    expect(screen.queryByText("Scheduled Creator")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "+ Add creator" }));
    const profileUrl = screen.getByRole("textbox", { name: "Creator profile URL" });
    fireEvent.change(profileUrl, { target: { value: original.profileUrl } });
    const parseButton = screen.getByRole("button", { name: "Parse creator" });
    await waitFor(() => expect(parseButton).toBeEnabled());
    fireEvent.click(parseButton);
    await waitFor(() => expect(parseCreator).toHaveBeenCalledWith(original.profileUrl));
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Follow creator" }));

    await waitFor(() => expect(followCreator).toHaveBeenCalled());
    const followInput = followCreator.mock.calls[0]?.[0];
    expect(followInput?.parsed.creator.creatorId).toBe("youtube:creator");
    expect(replacement.creatorId).not.toBe(original.creatorId);
    expect(screen.queryByRole("region", { name: "Historical import choice" })).not.toBeInTheDocument();
    expect(service.importCreatorBaseline).not.toHaveBeenCalled();
    expect(screen.getByText("Scheduled Creator")).toBeVisible();
  });
});


describe("Creator management parity", () => {
  it("combines local search and status filters without running a chargeable check", async () => {
    const service = signedInService();
    const setup = vi.fn(async () => ({ settings: { homeTimezone: "UTC", confirmed: true }, creators: [
      creator({ displayName: "Research Alpha" }),
      creator({ creatorId: "creator-2", displayName: "Research Beta", platform: "reddit", autoFetchEnabled: false }),
      creator({ creatorId: "creator-3", displayName: "Retry Creator", schedulerState: "retry_pending", activeJobId: "job-3" })
    ] }));
    service.autoFetchSetup = setup;
    service.runScheduled = vi.fn();
    service.runCreatorNow = vi.fn();
    render(<WorkbenchApp service={service} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-fetch" }));
    await screen.findByText("Research Alpha");
    fireEvent.click(screen.getByText(/Filters & sync/));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search creators" }), { target: { value: "research" } });
    expect(screen.queryByText("Retry Creator")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Monitoring status"), { target: { value: "paused" } });
    expect(screen.getByText("Research Beta")).toBeInTheDocument();
    expect(screen.queryByText("Research Alpha")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Creator platform"), { target: { value: "youtube" } });
    expect(screen.getByText("No matching creators.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Creator platform"), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search creators" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Monitoring status"), { target: { value: "attention" } });
    expect(screen.getByText("Retry Creator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("link", { name: "Open creator profile" })).toHaveAttribute("href", "https://youtube.com/@creator");
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh creators" }));
    await waitFor(() => expect(setup).toHaveBeenCalledTimes(2));
    expect(service.runScheduled).not.toHaveBeenCalled();
    expect(service.runCreatorNow).not.toHaveBeenCalled();
  });

  it("keeps the previous creator list and permits retry after refresh failure", async () => {
    const service = signedInService();
    service.autoFetchSetup = vi.fn()
      .mockResolvedValueOnce({ settings: { homeTimezone: "UTC", confirmed: true }, creators: [creator()] })
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce({ settings: { homeTimezone: "UTC", confirmed: true }, creators: [creator({ displayName: "Updated creator" })] });
    render(<WorkbenchApp service={service} />);
    fireEvent.click(screen.getByRole("button", { name: "Auto-fetch" }));
    await screen.findByText("Scheduled Creator");
    fireEvent.click(screen.getByText(/Filters & sync/));
    fireEvent.click(screen.getByRole("button", { name: "Refresh creators" }));
    await screen.findByText("This information couldn’t be loaded. Try again.");
    expect(screen.getByText("Scheduled Creator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh creators" }));
    await screen.findByText("Updated creator");
    expect(screen.queryByText("This information couldn’t be loaded. Try again.")).not.toBeInTheDocument();
  });
});

describe("Live account usage refresh", () => {
  it("refreshes authoritative header quota after Single Fetch", async () => {
    const service = signedInService();
    const initial = await service.account();
    const initialCapabilities = await service.capabilities();
    service.capabilities = vi.fn().mockResolvedValueOnce(initialCapabilities)
      .mockResolvedValue({ ...initialCapabilities, quotaRemaining: 98 });
    service.account = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue({ ...initial, subscription: { ...initial.subscription, remainingQuota: 98 } });
    render(<WorkbenchApp service={service} />);
    await screen.findByText("· pro · 99/100");
    fireEvent.change(screen.getByLabelText("Public post URL"), { target: { value: "https://youtube.com/watch?v=post-a" } });
    fireEvent.click(screen.getByRole("button", { name: "Fetch preview" }));
    await screen.findByText("· pro · 98/100");
    expect(service.previewSingle).toHaveBeenCalledTimes(1);
    expect(service.account).toHaveBeenCalledTimes(2);
  });
});

it("returns from completed Bulk results by clicking the Single Fetch navigation without losing loaded posts", async () => {
  const service = signedInService();
  vi.mocked(service.savePrepared).mockImplementation(async prepared => ({ successes: prepared.map(({manifest}) => successfulSave(manifest)), failures: [] }));
  render(<WorkbenchApp initialTab="bulk" service={service} />);
  await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
  fireEvent.change(await screen.findByRole("textbox", { name: "Creator profile URL" }), { target: { value: "https://youtube.com/@creator" } });
  fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
  await screen.findByText("Post A");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Post A" }));
  fireEvent.click(screen.getByRole("button", { name: "Review batch manifest" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save 1 notes to vault" }));
  await screen.findByRole("button", { name: "Close save results" });
  fireEvent.click(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Single Fetch" }));
  expect(screen.getByRole("textbox", { name: "Public post URL" })).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Bulk Fetch" }));
  expect(screen.getByRole("textbox", { name: "Creator profile URL" })).toBeVisible();
  expect(screen.getByText("Post A")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Close save results" })).not.toBeInTheDocument();
});

it("does not show internal device-code instructions while email login finishes automatically", async () => {
  const service = signedInService();
  service.authState = () => ({ status: "authorizing", provider: "email", authorization: { deviceCode: "internal-device", userCode: "INTERNAL", verificationUri: "https://example.com", expiresIn: 600, interval: 5 }, expiresAt: Date.now() + 600000, nextPollAt: Date.now() + 5000 });
  service.restoreAuth = async () => service.authState() as import("@/auth/AuthService").AuthState;
  render(<WorkbenchApp service={service} />);
  expect(screen.queryByRole("region", { name: "Device authorization" })).not.toBeInTheDocument();
  expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument();
});

it("extracts a Bulk share URL and hides the empty selection badge and missing title ID", async () => {
  const service = signedInService();
  const page = await service.fetchProfilePage("unused", null);
  vi.mocked(service.fetchProfilePage).mockClear().mockResolvedValue({ ...page, content: [{ ...page.content[0]!, title: undefined, author: { id: "gh_99e683ab18e1", displayName: "gh_99e683ab18e1" } }] });
  render(<WorkbenchApp initialTab="bulk" service={service} />);
  fireEvent.change(await screen.findByLabelText("Creator profile URL"), { target: { value: "推荐主页 https://xhslink.cn/o/6vXQzsZRUd3 复制打开" } });
  expect(screen.getByLabelText("Creator profile URL")).toHaveValue("https://xhslink.cn/o/6vXQzsZRUd3");
  await waitFor(() => expect(screen.getByRole("button", { name: "Fetch page" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
  await screen.findByRole("button", { name: "Preview Research A" });
  expect(service.fetchProfilePage).toHaveBeenCalledWith("https://xhslink.cn/o/6vXQzsZRUd3", null);
  const label = screen.getByRole("checkbox", { name: "Select visible" }).parentElement!;
  expect(label.querySelector("span")).toBeNull();
  expect(screen.queryByText("gh_99e683ab18e1")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Research A" }));
  expect(label.querySelector("span")).toHaveTextContent("1");
});

it("shows and persists the recent folder even when it is selected", async () => {
  const service = signedInService();
  service.uiPreferences = vi.fn(async () => ({ recentFolder: "AgentLens/Inbox", onboardingVersion: 1 }));
  service.setUiPreferences = vi.fn(async () => undefined);
  render(<WorkbenchApp initialTab="bulk" service={service} vaultFolders={["AgentLens/Inbox", "Research"]} />);
  await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
  fireEvent.change(await screen.findByLabelText("Creator profile URL"), { target: { value: "https://youtube.com/@creator" } });
  fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
  fireEvent.click(await screen.findByRole("button", { name: "Browse destination folder" }));
  expect(within(screen.getByRole("treeitem", { name: "AgentLens/Inbox" })).getByText("RECENTLY SELECTED")).toBeVisible();
  fireEvent.click(screen.getByRole("treeitem", { name: "Research" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Select Folder" })).getByRole("button", { name: "Save" }));
  expect(service.setUiPreferences).toHaveBeenCalledWith({ recentFolder: "Research" });
});

it("does not save a WeChat listing when fetching the full article fails", async () => {
  const service = signedInService(); const page = await service.fetchProfilePage("unused", null);
  vi.mocked(service.fetchProfilePage).mockResolvedValue({ ...page, content: [{ ...page.content[0]!, platform: "wechat_official_account", canonicalUrl: "https://mp.weixin.qq.com/s/article" }] });
  vi.mocked(service.previewSingle).mockRejectedValue(new Error("Article fetch failed"));
  render(<WorkbenchApp initialTab="bulk" service={service} />);
  await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
  fireEvent.change(await screen.findByLabelText("Creator profile URL"), { target: { value: "https://mp.weixin.qq.com/s/article" } });
  fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Post A" }));
  await screen.findByText("We couldn’t confirm whether this action finished. Contact Support before trying again.");
  fireEvent.click(screen.getByRole("button", { name: "Review batch manifest" }));
  await screen.findByText("We couldn’t confirm whether this action finished. Contact Support before trying again.");
  expect(service.savePrepared).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Save 1 notes to vault" })).not.toBeInTheDocument();
});

it("fetches a selected WeChat article in full and saves its detail receipt", async () => {
  const service = signedInService(); const page = await service.fetchProfilePage("unused", null);
  const post = { ...page.content[0]!, platform: "wechat_official_account", canonicalUrl: "https://mp.weixin.qq.com/s/article", text: "Article title" };
  vi.mocked(service.fetchProfilePage).mockResolvedValue({ ...page, content: [post] });
  vi.mocked(service.previewSingle).mockResolvedValue({ post: { ...post, text: "Full article\nSecond paragraph", body: "Full article\nSecond paragraph" }, fetchId: "full-article-receipt", demo: false });
  vi.mocked(service.savePrepared).mockResolvedValue({ successes: [], failures: [] });
  render(<WorkbenchApp initialTab="bulk" service={service} />);
  await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
  fireEvent.change(await screen.findByLabelText("Creator profile URL"), { target: { value: post.canonicalUrl } });
  fireEvent.click(screen.getByRole("button", { name: "Fetch page" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Post A" }));
  await waitFor(() => expect(service.previewSingle).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Review batch manifest" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save 1 notes to vault" }));
  await waitFor(() => expect(service.savePrepared).toHaveBeenCalled());
  expect(vi.mocked(service.savePrepared).mock.calls[0]![0][0]!.preview).toMatchObject({ fetchId: "full-article-receipt", post: { body: "Full article\nSecond paragraph" } });
  expect(service.previewSingle).toHaveBeenCalledTimes(1);
});

it("starts a fresh Save draft after changing individual selections following a completed batch", async () => {
  const service = signedInService();
  vi.mocked(service.savePrepared).mockImplementation(async prepared => ({successes:prepared.map(({manifest}) => successfulSave(manifest)),failures:[]}));
  render(<WorkbenchApp initialTab="bulk" service={service} />);
  await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
  fireEvent.change(await screen.findByLabelText("Creator profile URL"), {target:{value:"https://youtube.com/@creator"}});
  fireEvent.click(screen.getByRole("button", {name:"Fetch page"}));
  fireEvent.click(await screen.findByRole("checkbox", {name:"Select Post A"}));
  fireEvent.click(screen.getByRole("button", {name:"Review batch manifest"}));
  fireEvent.click(await screen.findByRole("button", {name:"Save 1 notes to vault"}));
  fireEvent.click(await screen.findByRole("button", {name:"Close save results"}));
  fireEvent.click(screen.getByRole("checkbox", {name:"Select Post A"}));
  fireEvent.click(screen.getByRole("checkbox", {name:"Select Post B"}));
  expect(screen.getByRole("button", {name:"Review batch manifest"})).toHaveTextContent(/^Save$/);
  fireEvent.click(screen.getByRole("button", {name:"Review batch manifest"}));
  fireEvent.click(await screen.findByRole("button", {name:"Save 1 notes to vault"}));
  await waitFor(() => expect(service.savePrepared).toHaveBeenCalledTimes(2));
  expect(vi.mocked(service.savePrepared).mock.calls[1]![0].map(entry => entry.preview.post.contentId)).toEqual(["post-b"]);
});

it("filters previously saved content independently of a new-copy write action", async () => {
  const service = signedInService();
  const original = service.planPreview;
  service.planPreview = vi.fn(async (preview, options) => ({...await original(preview,options), alreadySaved:preview.post.contentId === "post-a"}));
  render(<WorkbenchApp initialTab="bulk" service={service} />);
  await waitFor(() => expect(screen.getByLabelText("Account status")).toHaveTextContent("· pro · 99/100"));
  fireEvent.change(await screen.findByLabelText("Creator profile URL"), {target:{value:"https://youtube.com/@creator"}});
  fireEvent.click(screen.getByRole("button", {name:"Fetch page"}));
  fireEvent.click(await screen.findByRole("button", {name:"Already saved"}));
  await waitFor(() => expect(screen.getByRole("checkbox", {name:"Select Post A"})).toBeVisible());
  expect(screen.queryByRole("checkbox", {name:"Select Post B"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:"New"}));
  expect(screen.getByRole("checkbox", {name:"Select Post B"})).toBeVisible();
  expect(screen.queryByRole("checkbox", {name:"Select Post A"})).toBeNull();
  expect(screen.getByRole("button", {name:"Has media"})).toBeVisible();
});

it("keeps a completed partial row visibly partial while later batch rows are saving", async () => {
  const { BatchSaveView } = await import("@/ui/workbench/BatchSaveView");
  const service = signedInService();
  const page = await service.fetchProfilePage("unused", null);
  const entries = await Promise.all(page.content.map(async post => {
    const preview = {post,demo:false};
    return {preview,manifest:await service.planPreview(preview)};
  }));
  render(<BatchSaveView entries={entries} progress={{[entries[0]!.manifest.contentKey]:"partial · 0 attachment(s) saved · 1 failed"}} result={null} saving error={null} onBack={()=>{}} onSave={()=>{}} onRetry={()=>{}} />);
  expect(screen.getByText("Partial")).toBeVisible();
  expect(screen.queryByText("Success")).toBeNull();
  expect(screen.getByRole("progressbar",{name:"Batch save progress"})).toHaveAttribute("value","1");
});

 it.each(["refresh_failed", "denied", "expired"] as const)("returns %s to the in-plugin login instead of device authorization", async reason => {
  const service = signedInService();
  service.authState = () => ({ status: "error", reason });
  service.restoreAuth = async () => ({ status: "error", reason });
  service.signOut = vi.fn(async () => undefined);
  service.startSignIn = vi.fn();
  render(<WorkbenchApp service={service} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start again" }));
  await screen.findByLabelText(/^Password/);
  expect(service.signOut).toHaveBeenCalledOnce();
  expect(service.startSignIn).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Device authorization" })).not.toBeInTheDocument();
});

it.each(["google", "email"] as const)("restores pending %s authorization into the login page on window reopen", async provider => {
  const service = signedInService();
  service.authState = () => ({ status: "authorizing", provider, authorization: {
    deviceCode: "internal", userCode: "HIDDEN-CODE", verificationUri: "https://example.com", expiresIn: 600, interval: 5
  }, expiresAt: Date.now() + 600000, nextPollAt: Date.now() + 60000 });
  service.restoreAuth = async () => service.authState() as import("@/auth/AuthService").AuthState;
  render(<WorkbenchApp service={service} />);
  expect(await screen.findByLabelText(/^Password/)).toBeVisible();
  expect(screen.queryByRole("region", { name: "Device authorization" })).toBeNull();
  expect(screen.queryByText("HIDDEN-CODE")).toBeNull();
});
