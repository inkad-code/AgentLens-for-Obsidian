/** Shared notification contract v2. Identical copies are checked across the three products.
 * Display only: never use this text to determine task state or retry eligibility.
 * Original Error objects and persisted messages remain available for diagnostics.
 */
export type FeedbackContext = "action" | "read_only" | "auth" | "fetch" | "save";
export const feedbackCopy = {
  "signIn": "Sign in to AgentLens to continue.",
  "signInFailed": "Sign-in could not be completed. Start again.",
  "plan": "An active plan is needed for this action. Review your plan.",
  "planExpired": "Your plan has expired. Review your plan.",
  "credits": "You don’t have enough credits for this action. Review your plan.",
  "link": "Enter a public post or profile link.",
  "unsupported": "This type of link isn’t available here. Choose a supported link.",
  "unavailable": "This content is unavailable. Check the original link.",
  "expiredLink": "This download link has expired. Load the post again.",
  "unverified": "We couldn’t confirm this is the original post. Check the original link.",
  "identity": "We couldn’t identify this post. Check the original link.",
  "mismatch": "This content doesn’t match the selection. Check the original link.",
  "incomplete": "Some posts couldn’t be loaded. The results are incomplete. Contact Support for help.",
  "recovery": "This check couldn’t continue. Contact Support for help.",
  "folder": "This folder is no longer available. Choose another folder.",
  "destination": "This task’s destination couldn’t be confirmed. Contact Support for help.",
  "unknownResult": "We couldn’t confirm whether this action finished. Contact Support before trying again.",
  "failed": "This action couldn’t be completed. Contact Support for help.",
  "conflict": "This action changed before it could finish. Review it before trying again.",
  "processing": "This action is still in progress. No action is needed.",
  "busy": "This check couldn’t start. Try again later.",
  "paused": "Automatic checks are paused. Resume them when you’re ready.",
  "creatorMissing": "This creator is no longer in your list. Reload the list.",
  "frequency": "Choose an available check interval.",
  "fixedTimes": "Remove the fixed times to use this interval.",
  "frequencyUnavailable": "This interval isn’t available for your account. Choose another interval.",
  "frequencyLimit": "You’ve reached the limit for this interval. Choose another interval.",
  "update": "Update the AgentLens plugin to continue.",
  "access": "This action isn’t available for your account. Contact Support for help.",
  "download": "Some files couldn’t be saved. Review the results before trying again.",
  "noteConflict": "This note couldn’t be safely updated. Review it before trying again.",
  "receipt": "The save result couldn’t be synced. Check the saved content before trying again.",
  "load": "This content couldn’t be loaded right now. Try again later.",
  "connection": "AgentLens couldn’t connect. Check your connection and try again.",
  "read": "This information couldn’t be loaded. Try again.",
  "password": "The email or password is incorrect. Check them and try again.",
  "registered": "This email is already registered. Sign in instead.",
  "cancelled": "Stopped. Check the results for items already saved.",
  "noMedia": "This post has no downloadable media. No action is needed."
} as const;
const codeKeys: Readonly<Record<string, keyof typeof feedbackCopy>> = {
  "AUTH_REQUIRED": "signIn",
  "AUTH_EXPIRED": "signIn",
  "AUTH_UNAUTHORIZED": "signIn",
  "auth_required": "signIn",
  "INVALID_TOKEN": "signIn",
  "DEVICE_CODE_EXPIRED": "signInFailed",
  "OAUTH_ERROR": "signInFailed",
  "SUBSCRIPTION_REQUIRED": "plan",
  "SUBSCRIPTION_EXPIRED": "planExpired",
  "INSUFFICIENT_QUOTA": "credits",
  "QUOTA_EXCEEDED": "credits",
  "quota_exhausted": "credits",
  "INVALID_URL": "link",
  "INVALID_SOURCE_URL": "link",
  "UNSUPPORTED_PLATFORM": "unsupported",
  "PLATFORM_NOT_SUPPORTED": "unsupported",
  "PROFILE_FETCH_NOT_SUPPORTED": "unsupported",
  "MODE_MISMATCH": "unsupported",
  "PLATFORM_MODE_DISABLED": "unsupported",
  "URL_TYPE_NOT_SUPPORTED": "unsupported",
  "MEDIA_NO_LONGER_AVAILABLE": "unavailable",
  "MEDIA_ITEM_NO_LONGER_AVAILABLE": "unavailable",
  "MEDIA_URL_EXPIRED": "expiredLink",
  "MEDIA_REFRESH_REQUIRES_REFETCH": "unverified",
  "UNSTABLE_CONTENT_IDENTITY": "identity",
  "MEDIA_REFRESH_SOURCE_CHANGED": "mismatch",
  "DELIVERY_MEDIA_MISMATCH": "mismatch",
  "CREATOR_IDENTITY_MISMATCH": "mismatch",
  "UPSTREAM_INVALID_PAGINATION": "incomplete",
  "UPSTREAM_PUBLISHED_AT_INVALID": "incomplete",
  "BASELINE_STATE_INVALID": "recovery",
  "INVALID_CURSOR": "recovery",
  "FOLDER_NOT_FOUND": "folder",
  "DELIVERY_TARGET_MISMATCH": "destination",
  "EXECUTION_RECONCILIATION_REQUIRED": "unknownResult",
  "STALE_EXECUTION_LEASE": "unknownResult",
  "OPERATION_CONFLICT": "unknownResult",
  "OPERATION_PAGE_CONFLICT": "unknownResult",
  "DELIVERY_OPERATION_MISMATCH": "unknownResult",
  "DELIVERY_EVIDENCE_CONFLICT": "unknownResult",
  "DELIVERY_MANIFEST_NOT_FOUND": "unknownResult",
  "OPERATION_ID_REQUIRED": "failed",
  "OPERATION_NOT_FOUND": "failed",
  "EXECUTION_FAILED": "failed",
  "UNKNOWN": "failed",
  "unknown": "failed",
  "INVALID_JSON": "failed",
  "INTERNAL_ERROR": "failed",
  "INVALID_RESPONSE": "failed",
  "invalid_response": "failed",
  "IDEMPOTENCY_CONFLICT": "conflict",
  "IDEMPOTENCY_IN_PROGRESS": "processing",
  "EXECUTION_CAPACITY_BUSY": "busy",
  "CREATOR_PAUSED": "paused",
  "CREATOR_NOT_FOUND": "creatorMissing",
  "INVALID_FREQUENCY": "frequency",
  "INVALID_PREFERRED_TIMES_FOR_MINUTE": "fixedTimes",
  "TEST_FREQUENCY_NOT_AVAILABLE": "frequencyUnavailable",
  "MINUTE_FREQUENCY_CREATOR_LIMIT": "frequencyLimit",
  "SCHEMA_INCOMPATIBLE": "update",
  "forbidden": "access",
  "FORBIDDEN": "access",
  "AUTH_FORBIDDEN": "access",
  "MEDIA_DOWNLOAD_FAILED": "download",
  "EAGLE_ADD_URL_FAILED": "download",
  "EAGLE_ADD_PATH_FAILED": "download",
  "vault_write_failed": "download",
  "vault_conflict": "noteConflict",
  "IMPORT_RESULT_CALLBACK_FAILED": "receipt",
  "RATE_LIMITED": "load",
  "RATE_LIMIT_EXCEEDED": "load",
  "SERVER_BUSY": "load",
  "rate_limited": "load",
  "provider_unavailable": "load",
  "UPSTREAM_TIMEOUT": "load",
  "UPSTREAM_ERROR": "load",
  "FETCH_FAILED": "load",
  "UPSTREAM_PARSE_FAILED": "load",
  "UPSTREAM_INVALID_RESPONSE": "load",
  "NETWORK_OFFLINE": "connection",
  "NETWORK_TIMEOUT": "connection",
  "network_unavailable": "connection"
};
const legacyCopy: Readonly<Record<string, string>> = {
  "Other checks are using the available capacity. This check will wait for its retry time.": "This check couldn’t start. Try again later.",
  "This execution is no longer active. Recover the original operation before continuing.": "We couldn’t confirm whether this action finished. Contact Support before trying again.",
  "The previous page is still being resolved. Continue using the original operation.": "We couldn’t confirm whether this action finished. Contact Support before trying again.",
  "This operation belongs to a different check. Recover its original request.": "We couldn’t confirm whether this action finished. Contact Support before trying again.",
  "Resume this creator before starting another check. Queued downloads will continue.": "Automatic checks are paused. Resume them when you’re ready.",
  "The provider result is not yet known. Reconcile this request before starting another attempt.": "We couldn’t confirm whether this action finished. Contact Support before trying again.",
  "Sign in to AgentLens again to continue.": "Sign in to AgentLens to continue.",
  "This sign-in code expired. Start sign in again.": "Sign-in could not be completed. Start again.",
  "Your AgentLens plan has expired. Renew to continue fetching media.": "Your plan has expired. Review your plan.",
  "An active AgentLens plan is required. Open Billing to choose a plan.": "An active plan is needed for this action. Review your plan.",
  "Not enough fetch credits. Upgrade or buy an add-on pack.": "You don’t have enough credits for this action. Review your plan.",
  "This platform does not support creator profile fetching yet.": "This type of link isn’t available here. Choose a supported link.",
  "This media link expired. Refresh the result and retry.": "This download link has expired. Load the post again.",
  "AgentLens could not verify the original post. Fetch the original source again as a new result.": "We couldn’t confirm this is the original post. Check the original link.",
  "This source now resolves to different content. The existing Eagle item was kept unchanged.": "This content doesn’t match the selection. Check the original link.",
  "This source is no longer publicly available. Existing Eagle files were kept.": "This content is unavailable. Check the original link.",
  "This media item is no longer available in the original post.": "This content is unavailable. Check the original link.",
  "This media could not be downloaded. Check your connection and retry.": "Some files couldn’t be saved. Review the results before trying again.",
  "Eagle could not import this image URL. Retry using a local download.": "Some files couldn’t be saved. Review the results before trying again.",
  "Eagle could not import this file. Retry or choose another folder.": "Some files couldn’t be saved. Review the results before trying again.",
  "This Eagle folder no longer exists. Choose another folder.": "This folder is no longer available. Choose another folder.",
  "You are offline. Reconnect, then retry.": "AgentLens couldn’t connect. Check your connection and try again.",
  "AgentLens did not respond in time. Check your connection, then retry.": "AgentLens couldn’t connect. Check your connection and try again.",
  "AgentLens is receiving too many requests. Wait a moment, then retry.": "This content couldn’t be loaded right now. Try again later.",
  "AgentLens is temporarily busy. Retry in a moment.": "This content couldn’t be loaded right now. Try again later.",
  "This action changed while a retry was pending. Review it and try again.": "This action changed before it could finish. Review it before trying again.",
  "This action is still processing. Wait a moment, then retry.": "This action is still in progress. No action is needed.",
  "This profile reports more posts but did not provide a pagination cursor. Retry after the parser is updated.": "Some posts couldn’t be loaded. The results are incomplete. Contact Support for help.",
  "The creator feed returned an invalid publication time. Auto-Fetch stopped without advancing its cursor.": "Some posts couldn’t be loaded. The results are incomplete. Contact Support for help.",
  "This creator baseline is missing or invalid. Re-follow the creator before Auto-Fetch continues.": "This check couldn’t continue. Contact Support for help.",
  "The saved Auto-Fetch page cursor is invalid. Re-follow the creator before continuing.": "This check couldn’t continue. Contact Support for help.",
  "This followed creator no longer exists. Remove it from the list or follow it again.": "This creator is no longer in your list. Reload the list.",
  "AgentLens could not establish a stable content identity. Auto-Fetch stopped because stable recovery metadata is required.": "We couldn’t identify this post. Check the original link.",
  "The media provider returned an invalid response. AgentLens retried safely; try again later if the problem continues.": "This content couldn’t be loaded right now. Try again later.",
  "Choose a supported Auto-Fetch frequency.": "Choose an available check interval.",
  "Minute frequency cannot be combined with fixed preferred times.": "Remove the fixed times to use this interval.",
  "Minute frequency is not enabled for this account.": "This interval isn’t available for your account. Choose another interval.",
  "This account has reached its minute-frequency follow limit.": "You’ve reached the limit for this interval. Choose another interval.",
  "This plugin and the AgentLens API use incompatible data contracts. Update the plugin before continuing.": "Update the AgentLens plugin to continue.",
  "Invalid login credentials": "The email or password is incorrect. Check them and try again.",
  "Incorrect email or password": "The email or password is incorrect. Check them and try again.",
  "Failed to fetch": "AgentLens couldn’t connect. Check your connection and try again.",
  "Save cancelled.": "Stopped. Check the results for items already saved.",
  "Sign in before fetching a live source.": "Sign in to AgentLens to continue.",
  "Sign in before fetching a creator profile.": "Sign in to AgentLens to continue.",
  "Sign in to AgentLens first.": "Sign in to AgentLens to continue.",
  "The article returned does not match the selected post. Nothing was saved.": "This content doesn’t match the selection. Check the original link. Nothing was saved.",
  "The full article was not returned. Please retry before saving.": "The full post couldn’t be loaded. Try again before saving.",
  "The article list has changed. Please select the post again.": "The list has changed. Select the post again.",
  "This post is no longer in the loaded list.": "This post is no longer in the list. Load the list again.",
  "The selected folder no longer exists. Choose another folder.": "This folder is no longer available. Choose another folder.",
  "The check capacity is currently full. Try again after the current work finishes.": "This check couldn’t start. Try again later.",
  "The execution queue changed. Try this check again.": "This check couldn’t start. Try again.",
  "This manual check is already running in another window.": "This check is running in another window. No action is needed.",
  "The previous manual check is still unconfirmed. Wait for its result to be verified.": "We couldn’t confirm whether the previous check finished. Wait for its result before trying again.",
  "This creator is no longer followed.": "This creator is no longer in your list. Reload the list.",
  "Sign in before updating tasks.": "Sign in to AgentLens to continue.",
  "Sign in to the original account to retry.": "Sign in to the original account to continue.",
  "Open the original library to update this task.": "Open the original Eagle library to update this task.",
  "This task is no longer available.": "This task is no longer available. Reload the list.",
  "This parse is still finishing. Retry after its result is available.": "This check is still in progress. Wait for its result.",
  "This task is still confirming its import results. Try again after confirmation finishes.": "Saved files are still being checked. Wait for the result before trying again.",
  "Check the existing Eagle item before retrying this write.": "Check the existing Eagle item before trying to save it again.",
  "Fetch this source again to restore its download links.": "Load the post again to get new download links.",
  "Wait for this creator's current check to finish.": "This check is still in progress. Wait for its result.",
  "Unable to verify the signed-in account. Reconnect or sign in again before checking.": "Your account couldn’t be checked. Check your connection and try again.",
  "Enter a valid public social media URL.": "Enter a public post or profile link.",
  "Only HTTP and HTTPS links without credentials are supported.": "Enter a public post or profile link.",
  "Downloads are busy. Try Check Now again when resources are available.": "This check couldn’t start. Try again later.",
  "Checks are busy. Try Check Now again shortly.": "This check couldn’t start. Try again later.",
  "Open the original Eagle library before selecting a download target.": "Open the original Eagle library, then choose a folder.",
  "Open the original library before fetching missing media.": "Open the original Eagle library, then try again.",
  "Enter a valid public HTTP or HTTPS link.": "Enter a public post or profile link.",
  "Enter a valid public HTTP or HTTPS link without credentials.": "Enter a public post or profile link.",
  "The planned note path became occupied.": "This note couldn’t be safely updated. Review it before trying again.",
  "The planned note disappeared before it was written.": "This note couldn’t be safely updated. Review it before trying again.",
  "Managed block markers are missing.": "This note couldn’t be safely updated. Review it before trying again.",
  "Existing note is not managed by AgentLens": "This note couldn’t be safely updated. Review it before trying again.",
  "The recovery note path belongs to another note": "This task’s destination couldn’t be confirmed. Contact Support for help.",
  "New note": "A new note will be saved.",
  "Managed content is unchanged": "This note is already up to date. No action is needed.",
  "Managed content changed": "The saved note will be updated.",
  "The request is already processing.": "This action is still in progress. No action is needed.",
  "Account or library changed. Reopen this action in the current library.": "The account or library changed. Reopen this action to continue.",
  "Choose an available folder in this library.": "Choose an available folder in this library.",
  "The account has reached its minute-frequency creator limit.": "You’ve reached the limit for this interval. Choose another interval.",
  "Select a supported minute frequency.": "Choose an available check interval.",
  "Minute frequency is not available for this account.": "This interval isn’t available for your account. Choose another interval.",
  "Please enter a creator profile URL, not a single post URL.": "Enter a public creator profile link.",
  "Sign in first.": "Sign in to AgentLens to continue.",
  "Library changed. Choose a destination in the current library and try again.": "The library changed. Choose a folder in the current library.",
  "Account or library changed. Select the destination again.": "The account or library changed. Choose the destination again.",
  "Enter your email address first.": "Enter your email address first.",
  "Passwords do not match.": "Passwords do not match.",
  "The password must be at least 8 characters and include a letter, a number, and a special character.": "The password must be at least 8 characters and include a letter, a number, and a special character."
};
const knownCopy = new Set<string>([...Object.values(feedbackCopy), ...Object.values(legacyCopy)]);
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}
export function userMessage(error: unknown, context: FeedbackContext = "action"): string {
  const data = record(error);
  const execution = record(data.execution ?? record(data.details).execution);
  const readOnly = context === "read_only" || data.requestMethod === "GET";
  const rawCode = data.serverCode ?? data.code;
  const code = typeof rawCode === "string" || typeof rawCode === "number" ? String(rawCode) : "";
  const raw = typeof error === "string" ? error : typeof data.message === "string" ? data.message : "";
  // Evidence about an unconfirmed operation takes precedence over transport symptoms.
  if (execution.failureClass === "reconciliation_required") return feedbackCopy.unknownResult;
  if (context === "auth" && /invalid (login )?credentials|incorrect (email|password)|email (address )?or password is incorrect/i.test(raw)) return feedbackCopy.password;
  if (code === "vault_conflict" && ["Vault folder must be a non-empty relative path.", "Vault folder cannot escape the vault."].includes(raw)) return "Choose a folder inside this vault.";
  // These exact local guards run before dispatch. Do not apply this to transport failures.
  if (raw === "AgentLens is offline. No network request was started."
    || code === "NETWORK_OFFLINE" && ["You are offline. Reconnect, then retry this fetch.", "Reconnect before checking this creator."].includes(raw)) {
    return "You’re offline. Check your connection and try again. This action hasn’t started.";
  }
  if (/^AgentLens \d+\.\d+\.\d+ or newer is required\. Update in Obsidian Community Plugins before using live actions\.$/.test(raw)) {
    return feedbackCopy.update;
  }
  const key = codeKeys[code];
  if (key && key !== "failed") {
    if (key === "connection" && !readOnly && context !== "auth") return feedbackCopy.unknownResult;
    if (key === "load" && (data.retryable === false || execution.retryable === false)) return feedbackCopy.failed;
    if (key === "load" && readOnly) return feedbackCopy.read;
    if (key === "load" && typeof execution.retryAt === "string") {
      const at = new Date(execution.retryAt);
      if (Number.isFinite(at.getTime()) && at.getTime() > Date.now()) return `This action couldn’t finish. Try again after ${at.toLocaleString("en-US")}.`;
    }
    return feedbackCopy[key];
  }
  if (error instanceof TypeError && !readOnly && context !== "auth") return feedbackCopy.unknownResult;
  if (knownCopy.has(raw)) return raw;
  if (Object.prototype.hasOwnProperty.call(legacyCopy, raw)) return legacyCopy[raw]!;
  if (context === "auth") {
    if (/invalid (login )?credentials|incorrect (email|password)/i.test(raw)) return feedbackCopy.password;
    if (/already registered/i.test(raw)) return feedbackCopy.registered;
    return feedbackCopy.signInFailed;
  }
  if (data.status === 401 || data.httpStatus === 401) return feedbackCopy.signIn;
  if (readOnly) return feedbackCopy.read;
  if (error instanceof TypeError || /network|timeout|timed out|Failed to fetch/i.test(raw)) return feedbackCopy.unknownResult;
  return context === "action" || context === "save" ? feedbackCopy.unknownResult : feedbackCopy.failed;
}
