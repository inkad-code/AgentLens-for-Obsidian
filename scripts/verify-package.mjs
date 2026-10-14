import { readFile, stat } from "node:fs/promises";
import ts from "typescript";
import vm from "node:vm";
import { apiBaseFor, apiTargets } from "./api-targets.mjs";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const targetArgument = process.argv.find((argument) => argument.startsWith("--target="));
const target = targetArgument?.slice("--target=".length) ?? "production";
const expectedApiBase = apiBaseFor(target);

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) throw new Error(`${file} is missing or empty.`);
}

if ((await stat("main.js")).size > 2 * 1024 * 1024) {
  throw new Error("main.js exceeds the 2 MB release budget.");
}

if (manifest.version !== packageJson.version) {
  throw new Error("manifest.json and package.json versions differ.");
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error("versions.json does not match manifest minAppVersion.");
}
if (manifest.id.includes("obsidian") || manifest.id.endsWith("plugin")) {
  throw new Error("manifest id violates Obsidian naming rules.");
}

const bundle = await readFile("main.js", "utf8");
const profile = process.argv.find(argument => argument.startsWith("--profile="))?.slice("--profile=".length) ?? "full";
if (!["full", "single-fetch-review"].includes(profile)) throw new Error("Unknown release profile.");
if (!bundle.startsWith(`/* AgentLens release profile: ${profile} */`)) {
  throw new Error("Bundle release profile does not match the requested package.");
}
if (profile === "single-fetch-review") {
  if (target !== "production" || manifest.version !== "0.1.1") throw new Error("Review package must be production 0.1.1.");
  if (!bundle.includes("bulk-fetch-creator")) throw new Error("Review bundle is missing Bulk Fetch.");
  for (const command of ["add-creator-auto-fetch", "sync-due-creators", "Default Auto-Fetch frequency"]) {
    if (bundle.includes(command)) throw new Error(`Review bundle includes disabled entrypoint: ${command}`);
  }
}

for (const legacyText of ["Authorize Obsidian with code", "Check authorization", "Copy code"]) {
  if (bundle.includes(legacyText)) throw new Error(`Bundle contains removed device-code UI: ${legacyText}`);
}

if (!bundle.includes(expectedApiBase)) {
  throw new Error(`main.js does not contain the expected ${target} API base URL.`);
}
for (const [otherTarget, otherApiBase] of Object.entries(apiTargets)) {
  if (otherTarget !== target && bundle.includes(otherApiBase)) {
    throw new Error(`main.js for ${target} also contains the ${otherTarget} API base URL.`);
  }
}

// Desktop streaming dependencies must remain lazy, so mobile can load the bundle.
const allowedDesktopModules = new Set(["node:fs/promises", "node:os", "node:path", "node:http", "node:https", "node:timers", "electron", "@electron/remote", "assert", "buffer", "events", "http", "https", "net", "tls", "url", "util", "stream", "dns"]);
const bundleAst = ts.createSourceFile("main.js", bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function inspectDependencies(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
    const argument = node.arguments[0];
    if (argument && ts.isStringLiteral(argument) && argument.text !== "obsidian") {
      if (!allowedDesktopModules.has(argument.text)) throw new Error(`Unexpected desktop dependency: ${argument.text}`);
      let parent = node.parent;
      while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
      if (!parent) throw new Error(`Eager desktop dependency is unavailable on mobile: ${argument.text}`);
    }
  }
  ts.forEachChild(node, inspectDependencies);
}
inspectDependencies(bundleAst);
// A mobile runtime cannot load any desktop dependency, even through an eager wrapper.
vm.runInNewContext(bundle, {
  module: { exports: {} }, exports: {}, setTimeout, clearTimeout, TextEncoder, TextDecoder,
  require(name) {
    if (name !== "obsidian") throw new Error(`Desktop dependency loaded during mobile startup: ${name}`);
    return new Proxy({}, { get: () => class {} });
  }
}, { timeout: 5000 });

console.log(`Verified AgentLens Social Importer ${manifest.version} (${target}).`);
