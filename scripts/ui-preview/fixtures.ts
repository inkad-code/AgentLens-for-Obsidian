import { fixtureImages } from "./images";
import type { AgentLensWorkbenchPort } from "../../src/workbench/ports";
import type { BatchSaveResult, PreviewResult, PreparedSave, WriteOptions } from "../../src/workbench/types";
import type { NoteWriteManifest } from "../../src/vault/VaultWriter";
import type { CreatorRecord } from "../../src/api/AgentLensApiClient";
import type { NormalizedPost } from "../../src/core/domain";
const vi = { fn: (implementation: any = () => undefined) => implementation };
export function creator(overrides: Partial<CreatorRecord> = {}): CreatorRecord {
  return {
    creatorId: "creator-1",
    platform: "youtube",
    profileUrl: "https://youtube.com/@creator",
    displayName: "Scheduled Creator",
    handle: "creator",
    avatarUrl: fixtureImages.avatar,
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

export function signedInService(): AgentLensWorkbenchPort {
  const capabilities = {
    accountId: "account-1", plan: "pro", quotaRemaining: 99,
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
      media: [{ id: "media-a", kind: "video" as const, sourceUrl: "https://cdn.example/video.mp4", thumbnailUrl: fixtureImages.thumbnail, sizeBytes: 2048 }]
    },
    {
      platform: "youtube", contentId: "post-b", canonicalUrl: "https://youtube.com/watch?v=post-b",
      title: "Post B", text: "Research B", publishedAt: "2026-08-18T12:00:00Z",
      author: { id: "creator-1", displayName: "Creator", handle: "creator" }, media: []
    }
  ];
  const plan = vi.fn(async (post: typeof posts[number], options: WriteOptions = {}): Promise<NoteWriteManifest> => ({
    contentKey: `${post.platform}:${post.contentId}`,
    notePath: `${options.folderPath ?? "AgentLens/Inbox"}/${post.contentId}.md`,
    action: "new", reason: "New note", managedDigest: post.contentId,
    mediaPolicy: options.mediaPolicy === "link_only" || options.mediaPolicy === "download_images_only" ? options.mediaPolicy : "download_all",
    templateId: options.templateId === "compact" ? "compact" : "default",
    expectedOutcome: "complete",
    partialReasons: [],
    renderedManagedBlock: `# ${post.title}\n\n${post.text}`,
    frontmatter: { Platform: post.platform, Creator_name: post.author.displayName, Creator_url: null,
      Source_url: post.canonicalUrl, Published_at: post.publishedAt ?? null, Fetched_at: "2026-09-28T00:00:00Z",
      Media_count: post.media.length, Media_policy: options.mediaPolicy ?? "download_all", tags: [post.platform] },
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

export function successfulSave(
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

