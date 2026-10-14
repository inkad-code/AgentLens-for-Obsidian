import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiBaseFor, apiTargets } from "./api-targets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vault = path.join(root, ".test-vault");
const obsidian = path.join(vault, ".obsidian");
const pluginId = "agentlens-social-importer";
const plugin = path.join(obsidian, "plugins", pluginId);
const target = process.argv.find((argument) => argument.startsWith("--target="))?.slice("--target=".length) ?? "local";
if (target !== "local" && target !== "development") throw new Error(`Unknown host-test target: ${target}.`);
const expectedApiBase = apiBaseFor(target);
if (target === "development" && process.env.AGENTLENS_ALLOW_REMOTE_DEV_HOST_TEST !== "1") {
  throw new Error("Refusing remote development host install without AGENTLENS_ALLOW_REMOTE_DEV_HOST_TEST=1.");
}
const forbiddenApiBases = Object.values(apiTargets).filter((value) => value !== expectedApiBase);

const sourceBundle = await readFile(path.join(root, "main.js"), "utf8");
if (!sourceBundle.includes(expectedApiBase)) {
  throw new Error(`Refusing to install a bundle for the wrong target: expected ${expectedApiBase}.`);
}
for (const forbiddenApiBase of forbiddenApiBases) {
  if (sourceBundle.includes(forbiddenApiBase)) {
    throw new Error(`Refusing to install a mixed-target bundle containing ${forbiddenApiBase}.`);
  }
}

await mkdir(plugin, { recursive: true });
await Promise.all([
  cp(path.join(root, "main.js"), path.join(plugin, "main.js")),
  cp(path.join(root, "manifest.json"), path.join(plugin, "manifest.json")),
  cp(path.join(root, "styles.css"), path.join(plugin, "styles.css")),
  writeFile(path.join(obsidian, "community-plugins.json"), `${JSON.stringify([pluginId], null, 2)}\n`),
  writeFile(path.join(obsidian, "app.json"), `${JSON.stringify({ showUnsupportedFiles: true }, null, 2)}\n`),
  writeFile(path.join(vault, "AgentLens Host Test.md"), "# AgentLens Host Test\n\nIsolated development vault.\n")
]);

const installedBundle = await readFile(path.join(plugin, "main.js"), "utf8");
if (!installedBundle.includes(expectedApiBase)) {
  throw new Error(`Installed bundle does not target ${expectedApiBase}.`);
}
for (const forbiddenApiBase of forbiddenApiBases) {
  if (installedBundle.includes(forbiddenApiBase)) {
    throw new Error(`Installed bundle contains forbidden API target ${forbiddenApiBase}.`);
  }
}

console.log(`Installed ${pluginId} (${target}) into ${vault}`);
