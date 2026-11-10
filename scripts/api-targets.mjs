import { readFile } from "node:fs/promises";

export const apiTargets = Object.freeze(JSON.parse(
  await readFile(new URL("../api-targets.json", import.meta.url), "utf8")
));

export function apiBaseFor(target) {
  const apiBase = apiTargets[target];
  if (typeof apiBase !== "string") throw new Error(`Unsupported API target: ${target}.`);
  return apiBase;
}
