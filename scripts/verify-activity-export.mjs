import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run verify:activity-export -- <export.json>");

const payload = JSON.parse(await readFile(file, "utf8"));
const stats = verifyActivityExport(payload);
console.log(`Verified obsidian-activity-v1 export: ${stats.items} item(s), ${stats.chargedUnits} charged unit(s), ${stats.failed} failed.`);

export function verifyActivityExport(value) {
  const root = record(value, "export");
  exactKeys(root, ["schema", "generatedAt", "retentionDays", "retainedFrom", "truncated", "items"], "export");
  if (root.schema !== "obsidian-activity-v1") fail("export.schema is invalid");
  isoDate(root.generatedAt, "export.generatedAt");
  if (root.retentionDays !== 90) fail("export.retentionDays must be 90");
  isoDate(root.retainedFrom, "export.retainedFrom");
  boolean(root.truncated, "export.truncated");
  if (!Array.isArray(root.items)) fail("export.items must be an array");
  if (root.items.length > 10_000) fail("export.items exceeds the 10000-item contract limit");

  const stats = { items: root.items.length, chargedUnits: 0, failed: 0 };
  root.items.forEach((item, index) => {
    const detail = record(item, `items[${index}]`);
    exactKeys(detail, ["summary", "diagnostics"], `items[${index}]`);
    const summary = verifySummary(detail.summary, index);
    const diagnostics = verifyDiagnostics(detail.diagnostics, index);
    if (summary.chargedUnits !== diagnostics.chargedUnits) {
      fail(`items[${index}] chargedUnits differs between summary and diagnostics`);
    }
    stats.chargedUnits += summary.chargedUnits;
    if (summary.result === "failed") stats.failed += 1;
  });

  scanSensitiveMaterial(root, "export");
  return Object.freeze(stats);
}

function verifySummary(value, index) {
  const path = `items[${index}].summary`;
  const summary = record(value, path);
  exactKeys(summary, [
    "activityId", "operation", "platform", "targetAlias", "occurredAt", "result",
    "chargedUnits", "relativeNotePath", "fileCount", "deleted"
  ], path);
  boundedString(summary.activityId, `${path}.activityId`, 128);
  oneOf(summary.operation, ["single_fetch", "profile_bulk_fetch", "auto_fetch", "creator_settings", "creator_pause", "creator_resume", "creator_delete"], `${path}.operation`);
  optionalBoundedString(summary.platform, `${path}.platform`, 64);
  optionalBoundedString(summary.targetAlias, `${path}.targetAlias`, 256);
  isoDate(summary.occurredAt, `${path}.occurredAt`);
  oneOf(summary.result, ["success", "partial", "failed"], `${path}.result`);
  nonNegativeInteger(summary.chargedUnits, `${path}.chargedUnits`);
  relativePathOrNull(summary.relativeNotePath, `${path}.relativeNotePath`);
  nonNegativeInteger(summary.fileCount, `${path}.fileCount`);
  boolean(summary.deleted, `${path}.deleted`);
  return summary;
}

function verifyDiagnostics(value, index) {
  const path = `items[${index}].diagnostics`;
  const diagnostics = record(value, path);
  exactKeys(diagnostics, [
    "requestId", "fetchId", "runId", "cursorRef", "pageNumber", "trigger",
    "chargedUnits", "reusedExisting", "errorCode", "errorSummary"
  ], path);
  for (const key of ["requestId", "fetchId", "runId", "cursorRef", "trigger", "errorCode"]) {
    optionalBoundedString(diagnostics[key], `${path}.${key}`, 256);
  }
  if (diagnostics.pageNumber !== null) nonNegativeInteger(diagnostics.pageNumber, `${path}.pageNumber`);
  nonNegativeInteger(diagnostics.chargedUnits, `${path}.chargedUnits`);
  boolean(diagnostics.reusedExisting, `${path}.reusedExisting`);
  optionalBoundedString(diagnostics.errorSummary, `${path}.errorSummary`, 512);
  return diagnostics;
}

function scanSensitiveMaterial(value, path) {
  if (typeof value === "string") {
    const forbidden = [
      /\bBearer\s+\S+/i,
      /\bal_(?:live|test)_[A-Za-z0-9_-]+/,
      /\b(?:access|refresh)[_-]?token\b/i,
      /[?&](?:access_?token|refresh_?token|token|signature|sig|api_?key|key)=/i,
      /\/Users\/[^/\s]+/,
      /[A-Za-z]:\\Users\\/i,
      /-----BEGIN [^-]*PRIVATE KEY-----/i,
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/
    ];
    if (forbidden.some((pattern) => pattern.test(value))) fail(`${path} contains sensitive material`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSensitiveMaterial(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:accessToken|refreshToken|authorization|cookie|apiKey|sourceUrl|canonicalUrl|content|body|payload)$/i.test(key)) {
        fail(`${path}.${key} is not permitted in an Activity export`);
      }
      scanSensitiveMaterial(item, `${path}.${key}`);
    }
  }
}

function exactKeys(value, allowed, path) {
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${path} keys do not match the Activity export whitelist`);
  }
}

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object`);
  return value;
}

function boundedString(value, path, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /\r|\n/.test(value)) {
    fail(`${path} must be a bounded single-line string`);
  }
}

function optionalBoundedString(value, path, max) {
  if (value === null) return;
  boundedString(value, path, max);
}

function oneOf(value, allowed, path) {
  if (!allowed.includes(value)) fail(`${path} is invalid`);
}

function isoDate(value, path) {
  boundedString(value, path, 64);
  if (!Number.isFinite(Date.parse(value))) fail(`${path} must be an ISO timestamp`);
}

function nonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) fail(`${path} must be a non-negative integer`);
}

function boolean(value, path) {
  if (typeof value !== "boolean") fail(`${path} must be boolean`);
}

function relativePathOrNull(value, path) {
  if (value === null) return;
  boundedString(value, path, 1024);
  // Multi-note receipts expose a common destination with a trailing slash.
  const segments = (value.endsWith("/") ? value.slice(0, -1) : value).split("/");
  if (value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:\//.test(value)
      || segments.some((segment) => segment === ".." || segment === "")) {
    fail(`${path} must be a Vault-relative POSIX path`);
  }
}

function fail(message) {
  throw new Error(`Activity export verification failed: ${message}.`);
}
