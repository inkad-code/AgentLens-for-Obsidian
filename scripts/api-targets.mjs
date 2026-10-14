import { readFile } from "node:fs/promises";

const configuredTargets = JSON.parse(
  await readFile(new URL("../api-targets.json", import.meta.url), "utf8")
);
const developmentApiBase = process.env.AGENTLENS_DEV_API_BASE_URL?.trim();
if (developmentApiBase) {
  const url = new URL(developmentApiBase);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("AGENTLENS_DEV_API_BASE_URL must be an HTTPS URL without credentials, query, or fragment.");
  }
  const normalized = developmentApiBase.replace(/\/+$/, "");
  if (Object.values(configuredTargets).includes(normalized)) {
    throw new Error("The development API must differ from production and local targets.");
  }
  configuredTargets.development = normalized;
}
export const apiTargets = Object.freeze(configuredTargets);

export function apiBaseFor(target) {
  const apiBase = apiTargets[target];
  if (target === "development" && !apiBase) {
    throw new Error("Set AGENTLENS_DEV_API_BASE_URL before building or verifying a development bundle.");
  }
  if (typeof apiBase !== "string") throw new Error(`Unsupported API target: ${target}.`);
  return apiBase;
}
