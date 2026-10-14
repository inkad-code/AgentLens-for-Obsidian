import { SINGLE_FETCH_REVIEW } from "../core/releaseProfile";
import { validateHistoryRange, validateScheduleHistory, type ScheduleHistoryPage } from "./scheduleHistory";
import { cleanPostText, cleanPostTitle } from "../core/domain";
import { OBSIDIAN_PLUGIN_CLIENT_TYPE, type AuthApi, type EmailCredentials } from "../auth/AuthService";
import type { DeviceAuthorization, DevicePollResult, AccountCapabilities, PublicPlatformCatalog } from "./contracts";
import { validatePublicPlatformCatalog, validateAccountCapabilities, validateDeviceAuthorization } from "./contracts";
import type { MediaPolicy, NormalizedMedia, NormalizedPost } from "../core/domain";
import type { JsonTransport } from "../runtime/ObsidianRequestUrlTransport";
import { executionInteger, validateExecution, validateRecovery } from "./executions";
import type { ExecutionOperation, ExecutionRecovery } from "./executions";
import { validatePlans, validateDashboard, validateIntent, validateChange, record, text, secureBillingUrl, type BillingPort } from "./billing";

export interface AgentLensClientIdentity {
  installationId: string;
  deviceId: string;
  clientVersion: string;
  obsidianVersion: string;
  platform: "desktop_macos" | "desktop_windows" | "desktop_linux" | "mobile_ios" | "mobile_android";
}

export interface AccountSummary {
  user: { id: string; email: string; name: string };
  subscription: {
    plan: string;
    status: string;
    periodEnd: string | null;
    remainingQuota: number;
    totalQuota: number;
    addOnBalance: number;
    quotaRefreshAt: string | null;
    cancelAtPeriodEnd: boolean;
    billingUrl: string;
    fetchAllowed: boolean;
    fetchBlockedReason: string | null;
  };
  installationId: string;
}

export interface FetchPage {
  fetchId: string;
  mode: "single_post" | "profile_page";
  platform: string;
  content: readonly NormalizedPost[];
  page: { cursor: string | null; hasMore: boolean; pageNumber: number } | null;
  usage: { charged: boolean; units: number; remaining: number | null };
}

export interface WriteResultInput {
  contentKey: string;
  notePath: string;
  status: "success" | "partial" | "failed" | "skipped";
  errorCode?: string | undefined;
}

export interface WriteResultsRequest {
  fetchId?: string | undefined;
  creatorId?: string | undefined;
  fetchRunId?: string | undefined;
  runComplete?: boolean | undefined;
  requestId?: string | undefined;
  coverageComplete?: boolean | undefined;
  truncated?: boolean | undefined;
  stopReason?: string | undefined;
  runId: string;
  results: readonly WriteResultInput[];
}

export interface AutoFetchCapabilities {
  minuteFrequencyAvailable: boolean;
  minuteFrequencyMaxEvery: number;
  minuteCreatorLimit: number;
  minuteCreatorUsed: number;
}

export type FrequencyUnit = "minute" | "hour" | "day" | "week";

export type ActivityOperation =
  | "single_fetch"
  | "profile_bulk_fetch"
  | "auto_fetch"
  | "creator_settings"
  | "creator_pause"
  | "creator_resume"
  | "creator_delete";
export type ActivityResult = "success" | "partial" | "failed";

export interface ActivityFilters {
  operation?: ActivityOperation | undefined;
  result?: ActivityResult | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface ActivitySummary {
  activityId: string;
  operation: ActivityOperation;
  platform: string | null;
  targetAlias: string | null;
  occurredAt: string;
  result: ActivityResult;
  chargedUnits: number;
  relativeNotePath: string | null;
  fileCount: number;
  deleted: boolean;
}

export interface ActivityDiagnostics {
  requestId: string | null;
  fetchId: string | null;
  runId: string | null;
  cursorRef: string | null;
  pageNumber: number | null;
  trigger: string | null;
  chargedUnits: number;
  reusedExisting: boolean;
  errorCode: string | null;
  errorSummary: string | null;
}

export interface ActivityDetail {
  summary: ActivitySummary;
  diagnostics: ActivityDiagnostics;
}

export interface ActivityPage {
  through: string;
  items: readonly ActivitySummary[];
  nextCursor: string | null;
  pageSize: number;
  retentionDays: 90;
  retainedFrom: string;
}

export interface ActivityExport {
  schema: "obsidian-activity-v1";
  generatedAt: string;
  retentionDays: 90;
  retainedFrom: string;
  truncated: boolean;
  items: readonly ActivityDetail[];
}

/** Account configuration only; no destination or execution progress is inferred. */
export interface AccountFollow {
  followId: string;
  creator: { platform: string; displayName: string; handle: string | null; profileUrl: string };
  configRevision: number;
  frequency: { every: number; unit: FrequencyUnit };
  autoFetchEnabled: boolean;
}

export interface CreatorRecord {
  followId?: string | undefined;
  creatorId: string;
  platform: string;
  profileUrl: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  saveFolderPath: string;
  noteTemplateId: "default" | "compact";
  mediaPolicy: MediaPolicy;
  autoFetchEnabled: boolean;
  frequency: { every: number; unit: FrequencyUnit; displayText?: string | undefined };
  timezone: string;
  preferredTimes: readonly string[];
  nextCheckAt: string | null;
  lastCheckedAt: string | null;
  lastUpdateAt: string | null;
  lastResult: string | null;
  lastError: string | null;
  importedCount: number;
  schedulerState: string;
  retryAt: string | null;
  activeJobId: string | null;
  activeJobTrigger: string | null;
  lastSavedAt?: string | undefined;
  lastSavedCount?: number | undefined;
  lastSavedFetchRunId?: string | undefined;
}

export interface CreatorSettingsInput {
  saveFolderPath: string;
  timezone: string;
  every: number;
  unit: FrequencyUnit;
  preferredTimes?: readonly string[] | undefined;
  noteTemplateId: "default" | "compact";
  mediaPolicy: MediaPolicy;
}

export interface CreatorSchedulePreview {
  oldTimezone: string;
  newTimezone: string;
  oldNextCheckAt: string | null;
  newNextCheckAt: string | null;
  willRunImmediately: boolean;
  previewToken: string;
}

export interface CreatorParseResult {
  creator: { creatorId: string; platform: string; profileUrl: string; displayName: string; handle?: string | undefined; avatarUrl?: string | undefined };
  creatorToken: string;
  creatorTokenExpiresAt: string;
}

export interface SchedulerLease {
  creatorId: string;
  leaseId: string;
  trigger: string;
  saveFolderPath: string;
  noteTemplateId: "default" | "compact";
  mediaPolicy: MediaPolicy;
  schedulerState: string;
  nextCheckAt: string | null;
}

export type SchedulerReconcileReason =
  | "service_start"
  | "periodic_tick"
  | "network_restored"
  | "host_activated"
  | "manual_sync";

export interface SchedulerHealth {
  serverTime: string;
  installationId: string;
  status: string;
  clientVersion: string;
  obsidianVersion: string;
  lastSeenAt: string | null;
}

export interface DeleteCreatorResult {
  creatorId: string;
  deletedAt: string;
  futureSchedulingStopped: boolean;
  activeJobOutcome: string;
}

export interface CreatorUpdatePage {
  creatorId: string;
  leaseId: string;
  fetchRunId: string;
  fetchId: string;
  previews: readonly NormalizedPost[];
  cursor: string | null;
  hasMore: boolean;
  coverageComplete: boolean;
  truncated: boolean;
  stopReason: string | null;
  requestId: string | null;
}

export class AgentLensApiClient implements AuthApi {
  billing(accessToken: string): BillingPort {
    // Web billing endpoints return plain JSON, unlike the plugin API envelopes.
    const get = <T>(path: string, validate: (value: unknown) => T) => this.transport.json({ path, accessToken }, validate);
    const post = <T>(path: string, body: unknown, validate: (value: unknown) => T) => this.transport.json({ path, method: "POST", accessToken, body }, validate);
    return {
      plans: () => get("/plans", validatePlans),
      dashboard: () => get("/me/dashboard", validateDashboard),
      createIntent: selection => post("/billing/purchase-intents", { ...selection, sourcePage: "obsidian/plans" }, validateIntent),
      intent: id => get(`/billing/purchase-intents/${encodeURIComponent(id)}`, validateIntent),
      checkout: intentId => post("/billing/checkout", { intentId }, value => {
        const data = record(value);
        return { checkoutUrl: secureBillingUrl(data.checkoutUrl), status: text(data.status) };
      }),
      change: (action, plan, billingCycle) => post(`/billing/subscriptions/${action}`, { plan, billingCycle }, validateChange),
      portal: () => post("/billing/portal", {}, value => ({ portalUrl: secureBillingUrl(record(value).portalUrl) })),
      subscription: action => post(`/billing/subscriptions/${action}`, {}, value => { text(record(value).status); })
    };
  }
  constructor(
    private readonly transport: JsonTransport,
    private readonly identity: AgentLensClientIdentity,
    private readonly now: () => number = () => Date.now()
  ) {}

  currentClientVersion(): string {
    return this.identity.clientVersion;
  }

  registrationRequirements(): Promise<{humanVerificationRequired: boolean}> {
    return this.transport.json({path: "/auth/registration-requirements"}, value => {
      const required = requireRecord(value).humanVerificationRequired;
      if (typeof required !== "boolean") throw new Error("Invalid registration requirements.");
      return {humanVerificationRequired: required};
    });
  }

  authenticateEmail(credentials: EmailCredentials): Promise<string> {
    return this.transport.json({
      path: credentials.name === undefined ? "/auth/login" : "/auth/signup",
      method: "POST",
      body: credentials.name === undefined ? {email: credentials.email, password: credentials.password} : {email: credentials.email, password: credentials.password, name: credentials.name, ...(credentials.turnstileToken ? {turnstileToken: credentials.turnstileToken} : {})}
    }, value => requireString(requireRecord(value).token, "token"));
  }

  requestPasswordReset(email: string): Promise<string> {
    return this.transport.json({path: "/auth/forgot-password", method: "POST", body: {email}}, value => requireString(requireRecord(value).message,"message"));
  }

  async approveDevice(webToken: string, userCode: string): Promise<void> {
    await this.data({path: "/v1/auth/device/approve", method: "POST", accessToken: webToken, body: {userCode}}, value => requireRecord(value));
  }

  startDeviceAuthorization(): Promise<DeviceAuthorization> {
    return this.data({
      path: "/v1/auth/device/start",
      method: "POST",
      body: {
        clientType: OBSIDIAN_PLUGIN_CLIENT_TYPE,
        clientVersion: this.identity.clientVersion,
        installationId: this.identity.installationId,
        deviceId: this.identity.deviceId,
        obsidianVersion: this.identity.obsidianVersion,
        platform: this.identity.platform
      }
    }, validateDeviceAuthorization);
  }

  pollDeviceAuthorization(deviceCode: string): Promise<DevicePollResult> {
    return this.data({
      path: "/v1/auth/device/poll",
      method: "POST",
      body: { deviceCode }
    }, (value) => validatePoll(value, this.now()));
  }

  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string | undefined }> {
    return this.data({
      path: "/v1/auth/refresh",
      method: "POST",
      body: { refreshToken }
    }, (value) => validateSession(value, this.now()));
  }

  async revoke(refreshToken: string): Promise<void> {
    const session = await this.refresh(refreshToken);
    await this.data({
      path: "/v1/auth/logout",
      method: "POST",
      accessToken: session.accessToken,
      installationId: this.identity.installationId
    }, (value) => {
      const record = requireRecord(value);
      if (record.revoked !== true) throw new Error("logout was not acknowledged");
      return true;
    });
  }

  getExecution(accessToken: string, operationId: string): Promise<ExecutionOperation> {
    return this.data({ path: `/v1/plugins/executions/${encodeURIComponent(operationId)}`, method: "GET",
      accessToken, installationId: this.identity.installationId },
    (value) => validateExecution(value, operationId, this.identity.installationId));
  }

  inspectExecutionRecovery(accessToken: string, creatorId: string, operationId: string): Promise<ExecutionRecovery> {
    return this.data({ path: `/v1/plugins/creators/${encodeURIComponent(creatorId)}/execution-recovery?operationId=${encodeURIComponent(operationId)}`,
      method: "GET", accessToken, installationId: this.identity.installationId },
    (value) => validateRecovery(value, creatorId, operationId));
  }

  resumeUnstartedExecution(accessToken: string, creatorId: string, operationId: string, configRevision: number): Promise<ExecutionRecovery> {
    executionInteger(configRevision, "configRevision");
    return this.data({ path: `/v1/plugins/creators/${encodeURIComponent(creatorId)}/execution-recovery`, method: "POST",
      accessToken, installationId: this.identity.installationId, body: { operationId, configRevision } },
    (value) => validateRecovery(value, creatorId, operationId));
  }

  autoFetchCapabilities(accessToken: string): Promise<AutoFetchCapabilities> {
    return this.data({
      path: "/v1/plugins/settings/auto-fetch-capabilities",
      method: "GET",
      accessToken,
      installationId: this.identity.installationId
    }, (value) => {
      const record = requireRecord(value);
      const integer = (field: string, minimum: number): number => {
        const value = requireNonNegativeNumber(record[field], field);
        if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${field} is invalid`);
        return value;
      };
      return {
        minuteFrequencyAvailable: requireBoolean(record.minuteFrequencyAvailable, "minuteFrequencyAvailable"),
        minuteFrequencyMaxEvery: integer("minuteFrequencyMaxEvery", 1),
        minuteCreatorLimit: integer("minuteCreatorLimit", 0),
        minuteCreatorUsed: integer("minuteCreatorUsed", 0)
      };
    });
  }

  publicPlatformCatalog(): Promise<PublicPlatformCatalog> {
    return this.data({ path: `/v1/plugins/platform-catalog?clientType=${OBSIDIAN_PLUGIN_CLIENT_TYPE}` }, validatePublicPlatformCatalog);
  }

  capabilities(accessToken: string): Promise<AccountCapabilities> {
    return this.data({
      path: "/v1/plugins/capabilities",
      accessToken,
      installationId: this.identity.installationId
    }, validateAccountCapabilities);
  }

  account(accessToken: string): Promise<AccountSummary> {
    return this.data({
      path: "/v1/plugins/me",
      accessToken,
      installationId: this.identity.installationId
    }, validateAccountSummary);
  }

  demoFetch(mode: "single_post" | "profile_page", cursor?: string | null): Promise<FetchPage> {
    const route = mode === "single_post" ? "single" : "profile";
    return this.data({
      path: `/v1/plugins/demo/${route}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      method: "GET"
    }, validateFetchPage);
  }

  fetch(
    accessToken: string,
    input: { url: string; mode: "single_post" | "profile_page"; cursor?: string | undefined; pageSize?: number | undefined },
    idempotencyKey: string,
    requestId: string
  ): Promise<FetchPage> {
    return this.data({
      path: "/v1/plugins/fetch",
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      requestId,
      idempotencyKey,
      body: {
        url: input.url,
        mode: input.mode,
        cursor: input.cursor ?? null,
        pageSize: input.pageSize ?? 20,
        requestId,
        client: { type: "obsidian_plugin", version: this.identity.clientVersion }
      }
    }, validateFetchPage).then(page => {
      const handle = input.mode === "single_post" ? snapchatHandleFromUrl(input.url) : null;
      if (page.platform !== "snapchat" || !handle) return page;
      return { ...page, content: page.content.map(post => {
        const name = post.author.displayName.trim().toLowerCase();
        if (!["snapchat:unknown", "snapchat_unknown", "unknown", "snapchat"].includes(name)) return post;
        return { ...post, author: { ...post.author, displayName: handle, handle } };
      }) };
    });
  }

  refreshMedia(
    accessToken: string,
    contentId: string,
    mediaIds: readonly string[],
    idempotencyKey: string
  ): Promise<readonly NormalizedMedia[]> {
    return this.data({
      path: "/v1/plugins/media/refresh",
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      idempotencyKey,
      body: { contentId, mediaIds, reason: "download_failed" }
    }, (value) => {
      const record = requireRecord(value);
      if (!Array.isArray(record.media)) throw new Error("media must be an array");
      return Object.freeze(record.media.map((item) => normalizeMedia(requireRecord(item))));
    });
  }

  writeResults(
    accessToken: string,
    input: WriteResultsRequest,
    idempotencyKey: string
  ): Promise<{ accepted: number; success: number; partial: number; failed: number; skipped: number }> {
    return this.data({
      path: "/v1/obsidian/write-results",
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      idempotencyKey,
      body: input
    }, validateWriteAck);
  }

  settings(accessToken: string): Promise<{ homeTimezone: string | null; confirmed: boolean }> {
    return this.data({
      path: "/v1/plugins/settings",
      accessToken,
      installationId: this.identity.installationId
    }, (value) => {
      const record = requireRecord(value);
      return {
        homeTimezone: optionalString(record.homeTimezone) ?? null,
        confirmed: optionalString(record.homeTimezoneConfirmedAt) !== undefined
      };
    });
  }

  confirmTimezone(accessToken: string, timezone: string): Promise<{ homeTimezone: string }> {
    return this.data({
      path: "/v1/plugins/settings",
      method: "PATCH",
      accessToken,
      installationId: this.identity.installationId,
      idempotencyKey: `timezone-${timezone}`,
      body: { homeTimezone: timezone, confirmed: true }
    }, (value) => ({ homeTimezone: requireString(requireRecord(value).homeTimezone, "homeTimezone") }));
  }

  parseCreator(accessToken: string, profileUrl: string, idempotencyKey: string): Promise<CreatorParseResult> {
    return this.data({
      path: "/v1/plugins/creators/parse",
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      idempotencyKey,
      body: { profileUrl }
    }, validateCreatorParse);
  }

  createCreator(accessToken: string, input: {
    parsed: CreatorParseResult;
    saveFolderPath: string;
    timezone: string;
    every: number;
    unit: FrequencyUnit;
    preferredTimes?: readonly string[] | undefined;
    noteTemplateId: "default" | "compact";
    mediaPolicy: MediaPolicy;
  }, idempotencyKey: string): Promise<CreatorRecord> {
    return this.data({
      path: "/v1/plugins/creators",
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      idempotencyKey,
      body: {
        profileUrl: input.parsed.creator.profileUrl,
        platform: input.parsed.creator.platform,
        saveFolderId: `vault:${input.saveFolderPath}`,
        saveFolderPath: input.saveFolderPath,
        frequency: { every: input.every, unit: input.unit },
        timezone: input.timezone,
        preferredTimes: input.preferredTimes ?? [],
        noteTemplateId: input.noteTemplateId,
        mediaPolicy: input.mediaPolicy,
        autoFetchEnabled: true,
        creatorToken: input.parsed.creatorToken
      }
    }, validateCreator);
  }

  listCreators(accessToken: string): Promise<readonly CreatorRecord[]> {
    return this.data({
      path: "/v1/plugins/creators",
      accessToken,
      installationId: this.identity.installationId
    }, (value) => {
      if (!Array.isArray(value)) throw new Error("creators must be an array");
      return Object.freeze(value.map(validateCreator));
    });
  }

  updateCreator(accessToken: string, creatorId: string, enabled: boolean, idempotencyKey: string): Promise<CreatorRecord> {
    return this.data({
      path: `/v1/plugins/creators/${encodeURIComponent(creatorId)}`,
      method: "PATCH",
      accessToken,
      installationId: this.identity.installationId,
      idempotencyKey,
      body: { autoFetchEnabled: enabled }
    }, validateCreator);
  }

  previewCreatorSettings(
    accessToken: string,
    creatorId: string,
    input: CreatorSettingsInput
  ): Promise<CreatorSchedulePreview> {
    return this.data({
      path: `/v1/plugins/creators/${encodeURIComponent(creatorId)}/settings-preview`,
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      body: creatorSettingsBody(input)
    }, validateCreatorSchedulePreview);
  }

  updateCreatorSettings(
    accessToken: string,
    creatorId: string,
    input: CreatorSettingsInput,
    previewToken: string,
    idempotencyKey: string
  ): Promise<CreatorRecord> {
    return this.data({
      path: `/v1/plugins/creators/${encodeURIComponent(creatorId)}`,
      method: "PATCH",
      accessToken,
      installationId: this.identity.installationId,
      idempotencyKey,
      body: { ...creatorSettingsBody(input), previewToken }
    }, validateCreator);
  }

  deleteCreator(accessToken: string, creatorId: string, idempotencyKey: string): Promise<DeleteCreatorResult> {
    return this.data({
      path: `/v1/plugins/creators/${encodeURIComponent(creatorId)}`,
      method: "DELETE",
      accessToken,
      installationId: this.identity.installationId,
      idempotencyKey
    }, (value) => {
      const record = requireRecord(value);
      return {
        creatorId: requireString(record.creatorId, "creatorId"),
        deletedAt: requireString(record.deletedAt, "deletedAt"),
        futureSchedulingStopped: requireBoolean(record.futureSchedulingStopped, "futureSchedulingStopped"),
        activeJobOutcome: requireString(record.activeJobOutcome, "activeJobOutcome")
      };
    });
  }

  heartbeat(accessToken: string): Promise<SchedulerHealth> {
    return this.data({
      path: "/v1/obsidian/scheduler/heartbeat",
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      body: this.executorBody()
    }, validateSchedulerHealth);
  }

  schedulerHealth(accessToken: string): Promise<SchedulerHealth> {
    return this.data({
      path: "/v1/obsidian/scheduler/health",
      method: "GET",
      accessToken,
      installationId: this.identity.installationId
    }, validateSchedulerHealth);
  }

  reconcile(
    accessToken: string,
    reason: SchedulerReconcileReason,
    requestId: string,
    idempotencyKey: string
  ): Promise<{ serverTime: string; leases: readonly SchedulerLease[] }> {
    return this.data({
      path: "/v1/obsidian/scheduler/reconcile",
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      requestId,
      idempotencyKey,
      body: this.executorBody(reason)
    }, (value) => {
      const record = requireRecord(value);
      if (!Array.isArray(record.leases)) throw new Error("leases must be an array");
      return {
        serverTime: requireString(record.serverTime, "serverTime"),
        leases: Object.freeze(record.leases.map((lease) => {
          const item = requireRecord(lease);
          return {
            creatorId: requireString(item.creatorId, "lease.creatorId"),
            leaseId: requireString(item.leaseId, "lease.leaseId"),
            trigger: requireString(item.trigger, "lease.trigger"),
            saveFolderPath: requireString(item.saveFolderPath, "lease.saveFolderPath"),
            noteTemplateId: requireTemplateId(item.noteTemplateId, "lease.noteTemplateId"),
            mediaPolicy: requireMediaPolicy(item.mediaPolicy, "lease.mediaPolicy"),
            schedulerState: requireString(item.schedulerState, "lease.schedulerState"),
            nextCheckAt: optionalString(item.nextCheckAt) ?? null
          };
        }))
      };
    });
  }

  private executorBody(reason?: SchedulerReconcileReason): Record<string, string> {
    return {
      ...(reason === undefined ? {} : { reason }),
      hostState: "active",
      vaultState: "available",
      networkState: "online",
      clientVersion: this.identity.clientVersion
    };
  }

  creatorUpdates(
    accessToken: string,
    lease: SchedulerLease,
    cursor: string | null,
    requestId: string,
    idempotencyKey: string
  ): Promise<CreatorUpdatePage> {
    const query = new URLSearchParams({
      fetchRunId: lease.leaseId,
      trigger: lease.trigger,
      ...(cursor ? { cursor } : {})
    });
    return this.data({
      path: `/v1/plugins/creators/${encodeURIComponent(lease.creatorId)}/updates?${query}`,
      accessToken,
      installationId: this.identity.installationId,
      requestId,
      idempotencyKey
    }, validateCreatorUpdates);
  }

  manualCreatorUpdates(
    accessToken: string,
    creatorId: string,
    requestId: string,
    idempotencyKey: string
  ): Promise<CreatorUpdatePage> {
    return this.data({
      path: `/v1/obsidian/creators/${encodeURIComponent(creatorId)}/manual-check`,
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      requestId,
      idempotencyKey
    }, validateCreatorUpdates);
  }

  baselineImport(
    accessToken: string,
    creatorId: string,
    requestId: string,
    idempotencyKey: string
  ): Promise<FetchPage> {
    return this.data({
      path: `/v1/obsidian/creators/${encodeURIComponent(creatorId)}/baseline-import`,
      method: "POST",
      accessToken,
      installationId: this.identity.installationId,
      requestId,
      idempotencyKey
    }, validateFetchPage);
  }

  async unfollowAccount(accessToken: string, followId: string): Promise<void> {
    await this.data({ path: `/v1/plugins/follows/${encodeURIComponent(followId)}`, method: "DELETE", accessToken,
      installationId: this.identity.installationId }, value => {
      if (requireRecord(value).removed !== true) throw new Error("Account follow removal was not confirmed.");
      return undefined;
    });
  }

  accountFollows(accessToken: string): Promise<readonly AccountFollow[]> {
    return this.data({ path: "/v1/plugins/follows", method: "GET", accessToken, installationId: this.identity.installationId }, value => {
      if (!Array.isArray(value)) throw new Error("Invalid account follows");
      const ids = new Set<string>();
      return Object.freeze(value.map(item => {
        const row = requireRecord(item);
        const creator = requireRecord(row.creator);
        const frequency = requireRecord(row.frequency);
        const followId = requireString(row.followId, "followId");
        const configRevision = executionInteger(row.configRevision, "configRevision");
        const every = executionInteger(frequency.every, "frequency.every");
        if (ids.has(followId) || configRevision < 1 || every < 1) throw new Error("Invalid account follow identity or schedule");
        ids.add(followId);
        return { followId, configRevision,
          creator: { platform: requireString(creator.platform, "platform"), displayName: requireString(creator.displayName, "displayName"),
            handle: optionalString(creator.handle) ?? null, profileUrl: requireString(creator.profileUrl, "profileUrl") },
          frequency: { every, unit: requireFrequencyUnit(frequency.unit) }, autoFetchEnabled: requireBoolean(row.autoFetchEnabled, "autoFetchEnabled") };
      }));
    });
  }

  scheduleHistory(accessToken: string, followId: string, afterRevision = 0, throughRevision?: number): Promise<ScheduleHistoryPage> {
    validateHistoryRange(afterRevision, throughRevision);
    const query = new URLSearchParams({ afterRevision: String(afterRevision) });
    if (throughRevision !== undefined) query.set("throughRevision", String(throughRevision));
    return this.data({
      path: `/v1/plugins/follows/${encodeURIComponent(followId)}/schedule-history?${query}`,
      method: "GET", accessToken, installationId: this.identity.installationId
    }, value => validateScheduleHistory(value, followId, afterRevision, throughRevision));
  }

  async activity(
    accessToken: string,
    filters: ActivityFilters = {},
    cursor: string | null = null,
    pageSize = 25,
    through?: string
  ): Promise<ActivityPage> {
    if (cursor && !through) throw new Error("Activity continuation requires its original through boundary.");
    const query = new URLSearchParams(activityQuery(filters, { ...(cursor ? { cursor } : {}), pageSize }));
    query.delete("to");
    if (through ?? filters.to) query.set("through", through ?? filters.to!);
    return this.data({
      path: `/v1/plugins/activity?${query}`,
      method: "GET",
      accessToken,
      installationId: this.identity.installationId
    }, validateActivityPage);
  }

  activityDetail(accessToken: string, activityId: string): Promise<ActivityDetail> {
    return this.data({
      path: `/v1/plugins/activity/${encodeURIComponent(activityId)}`,
      method: "GET",
      accessToken,
      installationId: this.identity.installationId
    }, value => {
      const record = requireRecord(value);
      return { summary: validatePluginActivitySummary(record.summary), diagnostics: validateActivityDiagnostics(record.diagnostics) };
    });
  }

  exportActivity(accessToken: string, filters: ActivityFilters = {}): Promise<ActivityExport> {
    const query = new URLSearchParams(activityQuery(filters));
    query.delete("to");
    if (filters.to) query.set("through", filters.to);
    return this.transport.json({
      path: `/v1/plugins/activity/export${query.size ? `?${query}` : ""}`,
      method: "GET",
      accessToken,
      installationId: this.identity.installationId
    }, value => {
      const record = requireRecord(value);
      if (record.schema !== "plugin-activity-v1") throw new Error("activity export schema is invalid");
      requireString(record.through, "activity.through");
      if (!Array.isArray(record.items) || record.items.length > 10_000) throw new Error("activity export items exceed the contract limit");
      // Preserve the existing local diagnostic file format for support tooling.
      return validateActivityExport({ ...record, schema: "obsidian-activity-v1", items: record.items.map(value => {
        const detail = requireRecord(value);
        return { summary: validatePluginActivitySummary(detail.summary), diagnostics: detail.diagnostics };
      }) });
    });
  }

  private data<T>(
    request: Parameters<JsonTransport["json"]>[0],
    validateData: (value: unknown) => T
  ): Promise<T> {
    return this.transport.json(request, (value) => {
      const envelope = requireRecord(value);
      if (envelope.success !== true) throw new Error("API response was not successful");
      return validateData(envelope.data);
    });
  }
}

function activityQuery(
  filters: ActivityFilters,
  paging: { cursor?: string | undefined; pageSize?: number | undefined } = {}
): string {
  return new URLSearchParams({
    ...(filters.operation ? { operation: filters.operation } : {}),
    ...(filters.result ? { result: filters.result } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(paging.cursor ? { cursor: paging.cursor } : {}),
    ...(paging.pageSize ? { pageSize: String(paging.pageSize) } : {})
  }).toString();
}

function validatePoll(value: unknown, now: number): DevicePollResult {
  const record = requireRecord(value);
  const status = requireString(record.status, "status");
  if (status === "authorization_pending") {
    return { status, ...(numberOrNull(record.interval) === null ? {} : { interval: numberOrNull(record.interval) ?? undefined }) };
  }
  if (status === "slow_down") return { status, interval: requirePositiveNumber(record.interval, "interval") };
  if (status === "access_denied") return { status: "denied" };
  if (status === "expired_token") return { status: "expired" };
  if (status !== "authorized") throw new Error("unknown device authorization status");
  return {
    status: "authorized",
    accessToken: requireString(record.accessToken, "accessToken"),
    refreshToken: requireString(record.refreshToken, "refreshToken"),
    expiresIn: secondsUntil(record.accessTokenExpiresAt, now)
  };
}

function validateAccountSummary(value: unknown): AccountSummary {
  const record = requireRecord(value);
  const user = requireRecord(record.user);
  const subscription = requireRecord(record.subscription);
  const eligibility = requireRecord(subscription.fetchEligibility);
  return {
    user: {
      id: requireString(user.id, "user.id"),
      email: requireString(user.email, "user.email"),
      name: requireString(user.name, "user.name")
    },
    subscription: {
      plan: requireString(subscription.plan, "subscription.plan"),
      status: requireString(subscription.status, "subscription.status"),
      periodEnd: optionalString(subscription.periodEnd) ?? null,
      remainingQuota: requireNonNegativeNumber(subscription.remainingQuota, "subscription.remainingQuota"),
      totalQuota: requireNonNegativeNumber(subscription.totalQuota, "subscription.totalQuota"),
      addOnBalance: requireNonNegativeNumber(subscription.addOnBalance, "subscription.addOnBalance"),
      quotaRefreshAt: optionalString(subscription.quotaRefreshAt) ?? null,
      cancelAtPeriodEnd: requireBoolean(subscription.cancelAtPeriodEnd, "subscription.cancelAtPeriodEnd"),
      billingUrl: requireString(subscription.billingUrl, "subscription.billingUrl"),
      fetchAllowed: requireBoolean(eligibility.allowed, "subscription.fetchEligibility.allowed"),
      fetchBlockedReason: optionalString(eligibility.reason) ?? null
    },
    installationId: requireString(record.installationId, "installationId")
  };
}

function validateSession(value: unknown, now: number) {
  const record = requireRecord(value);
  return {
    accessToken: requireString(record.accessToken, "accessToken"),
    refreshToken: requireString(record.refreshToken, "refreshToken"),
    expiresIn: secondsUntil(record.accessTokenExpiresAt, now)
  };
}

function validateFetchPage(value: unknown): FetchPage {
  const record = requireRecord(value);
  if (!Array.isArray(record.content)) throw new Error("content must be an array");
  const creator = requireRecord(record.creator);
  const platform = requireString(record.platform, "platform");
  const content = record.content.map((item) => normalizeContent(requireRecord(item), creator, platform));
  const pageRecord = record.page === null || record.page === undefined ? null : requireRecord(record.page);
  const usage = requireRecord(record.usage);
  return {
    fetchId: requireString(record.fetchId, "fetchId"),
    mode: requireMode(record.mode),
    platform,
    content: Object.freeze(content),
    page: pageRecord === null ? null : {
      cursor: typeof pageRecord.cursor === "string" ? pageRecord.cursor : null,
      hasMore: requireBoolean(pageRecord.hasMore, "page.hasMore"),
      pageNumber: requirePositiveNumber(pageRecord.pageNumber, "page.pageNumber")
    },
    usage: {
      charged: requireBoolean(usage.charged, "usage.charged"),
      units: requireNonNegativeNumber(usage.units, "usage.units"),
      remaining: numberOrNull(usage.remaining)
    }
  };
}

function normalizeContent(
  content: Record<string, unknown>,
  creator: Record<string, unknown>,
  platform: string
): NormalizedPost {
  const source = requireRecord(content.source);
  const text = requireRecord(content.text);
  const media = Array.isArray(content.media)
    ? content.media.map((item) => normalizeMedia(requireRecord(item)))
    : [];
  return {
    platform,
    contentId: requireString(content.contentId, "contentId"),
    canonicalUrl: optionalString(source.canonicalUrl) ?? requireString(source.sourceUrl, "sourceUrl"),
    title: cleanPostTitle(optionalString(text.title) ?? "") || undefined,
    text: cleanPostText(optionalString(text.caption) ?? optionalString(text.summary) ?? (SINGLE_FETCH_REVIEW ? undefined : optionalString(text.transcript)) ?? ""),
    summary: optionalString(text.summary),
    body: typeof text.caption === "string" ? cleanPostText(text.caption) : undefined,
    transcript: SINGLE_FETCH_REVIEW ? undefined : optionalString(text.transcript),
    publishedAt: optionalString(source.publishedAt),
    author: {
      id: requireString(creator.creatorId, "creator.creatorId"),
      displayName: requireString(creator.displayName, "creator.displayName"),
      handle: optionalString(creator.handle),
      profileUrl: optionalString(creator.profileUrl)
    },
    media: Object.freeze(media)
  };
}

function snapchatHandleFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hostname !== "snapchat.com" && url.hostname !== "www.snapchat.com") return null;
    const match = /^\/@([a-z0-9._-]+)(?:\/|$)/i.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function normalizeMedia(media: Record<string, unknown>): NormalizedMedia {
  return {
    id: requireString(media.mediaId, "media.mediaId"),
    kind: mediaKind(media.mediaType),
    sourceUrl: requireString(media.downloadUrl, "media.downloadUrl"),
    filename: optionalString(media.suggestedFileName),
    mimeType: optionalString(media.mimeType),
    sizeBytes: numberOrNull(media.sizeBytes) ?? undefined,
    extension: optionalString(media.extension),
    downloadHeaders: stringRecord(media.downloadHeaders),
    downloadUrlExpiresAt: optionalString(media.downloadUrlExpiresAt),
    thumbnailUrl: optionalString(media.thumbnailUrl),
    coverUrl: optionalString(media.coverUrl),
    thumbnailExpiresAt: optionalString(media.thumbnailExpiresAt),
    width: numberOrNull(media.width) ?? undefined,
    height: numberOrNull(media.height) ?? undefined,
    durationSeconds: numberOrNull(media.durationSeconds) ?? undefined,
    tags: Array.isArray(media.tags)
      ? Object.freeze(media.tags.map((tag) => requireString(tag, "media.tags[]")))
      : undefined
  };
}

function validateWriteAck(value: unknown) {
  const record = requireRecord(value);
  return {
    accepted: requireNonNegativeNumber(record.accepted, "accepted"),
    success: requireNonNegativeNumber(record.success, "success"),
    partial: requireNonNegativeNumber(record.partial, "partial"),
    failed: requireNonNegativeNumber(record.failed, "failed"),
    skipped: requireNonNegativeNumber(record.skipped, "skipped")
  };
}

function validateActivityPage(value: unknown): ActivityPage {
  const record = requireRecord(value);
  if (!Array.isArray(record.items)) throw new Error("activity.items must be an array");
  const retentionDays = requireNonNegativeNumber(record.retentionDays, "activity.retentionDays");
  if (retentionDays !== 90) throw new Error("activity.retentionDays must be 90");
  return {
    through: requireString(record.through, "activity.through"),
    items: Object.freeze(record.items.map(validatePluginActivitySummary)),
    nextCursor: optionalString(record.nextCursor) ?? null,
    pageSize: requirePositiveNumber(record.pageSize, "activity.pageSize"),
    retentionDays: 90,
    retainedFrom: requireString(record.retainedFrom, "activity.retainedFrom")
  };
}

function validatePluginActivitySummary(value: unknown): ActivitySummary {
  const item = requireRecord(value);
  const extension = requireRecord(requireRecord(item.extensions).obsidian);
  return validateActivitySummary({ ...item, relativeNotePath: extension.relativeNotePath,
    fileCount: extension.fileCount, deleted: extension.deleted });
}

function validateActivitySummary(value: unknown): ActivitySummary {
  const record = requireRecord(value);
  return {
    activityId: requireString(record.activityId, "activityId"),
    operation: requireActivityOperation(record.operation),
    platform: optionalString(record.platform) ?? null,
    targetAlias: optionalString(record.targetAlias) ?? null,
    occurredAt: requireString(record.occurredAt, "occurredAt"),
    result: requireActivityResult(record.result),
    chargedUnits: requireNonNegativeNumber(record.chargedUnits, "chargedUnits"),
    relativeNotePath: validateActivityRelativePath(record.relativeNotePath),
    fileCount: requireNonNegativeNumber(record.fileCount, "fileCount"),
    deleted: requireBoolean(record.deleted, "deleted")
  };
}

function validateActivityRelativePath(value: unknown): string | null {
  const path = optionalString(value);
  if (!path) return null;
  if (
    path.startsWith("/")
    || path.includes("\\")
    || /^[A-Za-z]:\//.test(path)
    || path.split("/").some((segment) => segment === "..")
  ) {
    throw new Error("activity.relativeNotePath must be a Vault-relative POSIX path");
  }
  return path;
}

function validateActivityDiagnostics(value: unknown): ActivityDiagnostics {
  const record = requireRecord(value);
  return {
    requestId: optionalString(record.requestId) ?? null,
    fetchId: optionalString(record.fetchId) ?? null,
    runId: optionalString(record.runId) ?? null,
    cursorRef: optionalString(record.cursorRef) ?? null,
    pageNumber: numberOrNull(record.pageNumber),
    trigger: optionalString(record.trigger) ?? null,
    chargedUnits: requireNonNegativeNumber(record.chargedUnits, "diagnostics.chargedUnits"),
    reusedExisting: requireBoolean(record.reusedExisting, "diagnostics.reusedExisting"),
    errorCode: optionalString(record.errorCode) ?? null,
    errorSummary: validateActivityErrorSummary(record.errorSummary)
  };
}

function validateActivityErrorSummary(value: unknown): string | null {
  const summary = optionalString(value);
  if (!summary) return null;
  const containsSensitiveMaterial = [
    /\r|\n/,
    /\bBearer\s+\S+/i,
    /[?&](?:access_?token|refresh_?token|token|signature|sig|api_?key|key)=/i,
    /\/Users\/[^/\s]+/,
    /[A-Za-z]:\\Users\\/i,
    /-----BEGIN [^-]*PRIVATE KEY-----/i
  ].some((pattern) => pattern.test(summary));
  if (summary.length > 512 || containsSensitiveMaterial) {
    throw new Error("activity diagnostics contain unsafe error summary material");
  }
  return summary;
}

function validateActivityDetail(value: unknown): ActivityDetail {
  const record = requireRecord(value);
  return {
    summary: validateActivitySummary(record.summary),
    diagnostics: validateActivityDiagnostics(record.diagnostics)
  };
}

function validateActivityExport(value: unknown): ActivityExport {
  const record = requireRecord(value);
  if (record.schema !== "obsidian-activity-v1") throw new Error("activity export schema is invalid");
  if (!Array.isArray(record.items)) throw new Error("activity export items must be an array");
  if (record.retentionDays !== 90) throw new Error("activity export retentionDays must be 90");
  return {
    schema: "obsidian-activity-v1",
    generatedAt: requireString(record.generatedAt, "generatedAt"),
    retentionDays: 90,
    retainedFrom: requireString(record.retainedFrom, "retainedFrom"),
    truncated: requireBoolean(record.truncated, "truncated"),
    items: Object.freeze(record.items.map(validateActivityDetail))
  };
}

function requireActivityOperation(value: unknown): ActivityOperation {
  if (value !== "single_fetch" && value !== "profile_bulk_fetch" && value !== "auto_fetch"
      && value !== "creator_settings" && value !== "creator_pause"
      && value !== "creator_resume" && value !== "creator_delete") {
    throw new Error("activity operation is invalid");
  }
  return value;
}

function requireActivityResult(value: unknown): ActivityResult {
  if (value !== "success" && value !== "partial" && value !== "failed") {
    throw new Error("activity result is invalid");
  }
  return value;
}

function validateSchedulerHealth(value: unknown): SchedulerHealth {
  const record = requireRecord(value);
  return {
    serverTime: requireString(record.serverTime, "serverTime"),
    installationId: requireString(record.installationId, "installationId"),
    status: requireString(record.status, "status"),
    clientVersion: requireString(record.clientVersion, "clientVersion"),
    obsidianVersion: requireString(record.obsidianVersion, "obsidianVersion"),
    lastSeenAt: optionalString(record.lastSeenAt) ?? null
  };
}

function validateCreatorParse(value: unknown): CreatorParseResult {
  const record = requireRecord(value);
  const creator = requireRecord(record.creator);
  return {
    creator: {
      creatorId: requireString(creator.creatorId, "creator.creatorId"),
      platform: requireString(creator.platform, "creator.platform"),
      profileUrl: requireString(creator.profileUrl, "creator.profileUrl"),
      displayName: requireString(creator.displayName, "creator.displayName"),
      handle: optionalString(creator.handle),
      avatarUrl: optionalString(creator.avatarUrl)
    },
    creatorToken: requireString(record.creatorToken, "creatorToken"),
    creatorTokenExpiresAt: requireString(record.creatorTokenExpiresAt, "creatorTokenExpiresAt")
  };
}

function validateCreator(value: unknown): CreatorRecord {
  const record = requireRecord(value);
  const frequency = requireRecord(record.frequency);
  const preferredTimes = Array.isArray(record.preferredTimes)
    ? record.preferredTimes.map((value) => requireString(value, "preferredTimes[]"))
    : [];
  return {
    ...validateSavedStatistics(record),
    ...(optionalString(record.followId) ? { followId: optionalString(record.followId) } : {}),
    creatorId: requireString(record.creatorId, "creatorId"),
    platform: requireString(record.platform, "platform"),
    profileUrl: requireString(record.profileUrl, "profileUrl"),
    displayName: requireString(record.displayName, "displayName"),
    handle: optionalString(record.handle) ?? null,
    avatarUrl: optionalString(record.avatarUrl) ?? null,
    saveFolderPath: requireString(record.saveFolderPath, "saveFolderPath"),
    noteTemplateId: requireTemplateId(record.noteTemplateId, "noteTemplateId"),
    mediaPolicy: requireMediaPolicy(record.mediaPolicy, "mediaPolicy"),
    autoFetchEnabled: requireBoolean(record.autoFetchEnabled, "autoFetchEnabled"),
    frequency: {
      every: requirePositiveNumber(frequency.every, "frequency.every"),
      unit: requireFrequencyUnit(frequency.unit),
      ...(optionalString(frequency.displayText) ? { displayText: optionalString(frequency.displayText) } : {})
    },
    timezone: requireString(record.timezone, "timezone"),
    preferredTimes: Object.freeze(preferredTimes),
    nextCheckAt: optionalString(record.nextCheckAt) ?? null,
    lastCheckedAt: optionalString(record.lastCheckedAt) ?? null,
    lastUpdateAt: optionalString(record.lastUpdateAt) ?? null,
    lastResult: optionalString(record.lastResult) ?? null,
    lastError: optionalString(record.lastError) ?? null,
    importedCount: optionalNonNegativeNumber(record.importedCount) ?? 0,
    schedulerState: requireString(record.schedulerState, "schedulerState"),
    retryAt: optionalString(record.retryAt) ?? null,
    activeJobId: optionalString(record.activeJobId) ?? null,
    activeJobTrigger: optionalString(record.activeJobTrigger) ?? null
  };
}

function validateSavedStatistics(record: Record<string, unknown>): Pick<CreatorRecord, "lastSavedAt" | "lastSavedCount" | "lastSavedFetchRunId"> {
  const fields = [record.lastSavedAt, record.lastSavedCount, record.lastSavedFetchRunId];
  if (fields.every((field) => field === null || field === undefined)) return {};
  const at = requireString(record.lastSavedAt, "lastSavedAt");
  const count = requireNonNegativeNumber(record.lastSavedCount, "lastSavedCount");
  const run = requireString(record.lastSavedFetchRunId, "lastSavedFetchRunId");
  if (!Number.isFinite(Date.parse(at)) || !Number.isSafeInteger(count)) throw new Error("Invalid last saved statistics");
  return { lastSavedAt: at, lastSavedCount: count, lastSavedFetchRunId: run };
}

function creatorSettingsBody(input: CreatorSettingsInput): Record<string, unknown> {
  return {
    saveFolderId: `vault:${input.saveFolderPath}`,
    saveFolderPath: input.saveFolderPath,
    frequency: { every: input.every, unit: input.unit },
    timezone: input.timezone,
    preferredTimes: input.preferredTimes ?? [],
    noteTemplateId: input.noteTemplateId,
    mediaPolicy: input.mediaPolicy
  };
}

function validateCreatorSchedulePreview(value: unknown): CreatorSchedulePreview {
  const record = requireRecord(value);
  return {
    oldTimezone: requireString(record.oldTimezone, "oldTimezone"),
    newTimezone: requireString(record.newTimezone, "newTimezone"),
    oldNextCheckAt: optionalString(record.oldNextCheckAt) ?? null,
    newNextCheckAt: optionalString(record.newNextCheckAt) ?? null,
    willRunImmediately: requireBoolean(record.willRunImmediately, "willRunImmediately"),
    previewToken: requireString(record.previewToken, "previewToken")
  };
}

function requireFrequencyUnit(value: unknown): FrequencyUnit {
  if (value !== "minute" && value !== "hour" && value !== "day" && value !== "week") {
    throw new Error("frequency.unit must be minute, hour, day, or week");
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function requireTemplateId(value: unknown, field: string): "default" | "compact" {
  if (value !== "default" && value !== "compact") throw new Error(`${field} must be default or compact`);
  return value;
}

function requireMediaPolicy(value: unknown, field: string): MediaPolicy {
  if (value !== "download_all" && value !== "download_images_only" && value !== "link_only") {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function validateCreatorUpdates(value: unknown): CreatorUpdatePage {
  const record = requireRecord(value);
  if (!Array.isArray(record.content)) throw new Error("content must be an array");
  const page = record.page === null || record.page === undefined ? null : requireRecord(record.page);
  const previews = record.content.map((item) => normalizeUpdateContent(requireRecord(item)));
  const fetchRunId = requireString(record.fetchRunId, "fetchRunId");
  return {
    creatorId: requireString(record.creatorId, "creatorId"),
    // A completed check intentionally clears activeJobId before the response is
    // returned. fetchRunId remains stable and is the continuation identifier
    // for any subsequent page, so it is also the safe completed-state fallback.
    leaseId: optionalString(record.activeJobId) ?? fetchRunId,
    fetchRunId,
    fetchId: requireString(record.fetchId, "fetchId"),
    previews: Object.freeze(previews),
    cursor: page === null ? null : optionalString(page.cursor) ?? null,
    hasMore: page === null ? false : requireBoolean(page.hasMore, "page.hasMore"),
    coverageComplete: page === null ? true : requireBoolean(page.coverageComplete, "page.coverageComplete"),
    truncated: page === null ? false : requireBoolean(page.truncated, "page.truncated"),
    stopReason: page === null ? "no_next_page" : optionalString(page.stopReason) ?? null,
    requestId: page === null ? optionalString(record.lastRequestId) ?? null : optionalString(page.requestId) ?? null
  };
}

function normalizeUpdateContent(content: Record<string, unknown>): NormalizedPost {
  const source = requireRecord(content.source);
  const text = requireRecord(content.text);
  const platform = requireString(source.platform, "source.platform");
  return {
    platform,
    contentId: requireString(content.contentId, "contentId"),
    canonicalUrl: optionalString(source.canonicalUrl) ?? requireString(source.sourceUrl, "sourceUrl"),
    title: cleanPostTitle(optionalString(text.title) ?? "") || undefined,
    text: cleanPostText(optionalString(text.caption) ?? optionalString(text.summary) ?? (SINGLE_FETCH_REVIEW ? undefined : optionalString(text.transcript)) ?? ""),
    summary: optionalString(text.summary),
    body: typeof text.caption === "string" ? cleanPostText(text.caption) : undefined,
    transcript: SINGLE_FETCH_REVIEW ? undefined : optionalString(text.transcript),
    publishedAt: optionalString(source.publishedAt),
    author: {
      id: optionalString(source.creatorId) ?? `${platform}:creator`,
      displayName: optionalString(source.creatorName) ?? optionalString(source.creatorHandle) ?? "Creator",
      handle: optionalString(source.creatorHandle),
      profileUrl: optionalString(source.creatorUrl)
    },
    media: Object.freeze(Array.isArray(content.media)
      ? content.media.map((item) => normalizeMedia(requireRecord(item)))
      : [])
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function requireMode(value: unknown): "single_post" | "profile_page" {
  if (value !== "single_post" && value !== "profile_page") throw new Error("mode is invalid");
  return value;
}

function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
}

function requireNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`);
  return value;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function secondsUntil(value: unknown, now: number): number {
  const expiresAt = Date.parse(requireString(value, "accessTokenExpiresAt"));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("access token expiry is invalid");
  return Math.max(1, Math.floor((expiresAt - now) / 1000));
}

function mediaKind(value: unknown): NormalizedMedia["kind"] {
  const kind = typeof value === "string" ? value.toLowerCase() : "file";
  if (kind.includes("image") || kind === "photo") return "image";
  if (kind.includes("video")) return "video";
  if (kind.includes("audio")) return "audio";
  return "file";
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([, item]) => typeof item !== "string")) return undefined;
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}
