import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const sourceFiles = await walk("src");
const failures = [];

for (const file of sourceFiles.filter((path) => [".ts", ".tsx"].includes(extname(path)))) {
  const source = await readFile(file, "utf8");
  check(file, source, /\bconsole\.(?:log|debug|info|warn|error)\s*\(/, "Do not log source URLs, tokens or plugin payloads.");
  check(file, source, /\b(?:window|globalThis)\.fetch\s*\(/, "Use Obsidian requestUrl through the AgentLens transport.");
  check(file, source, /\b(?:localStorage|sessionStorage)\b/, "Persist through PluginStateStore or SecretStorage.");
  if (file !== "src/vault/DesktopMediaDownloader.ts") check(file, source, /(?:from\s+|import\s*\()["'](?:node:|electron(?:["'/])|fs(?:["'/])|path(?:["'/])|os(?:["'/])|child_process(?:["'/]))/, "Mobile-compatible source must not import Node or Electron modules.");
  if (file !== "src/vault/DesktopMediaDownloader.ts") check(file, source, /\brequire\s*\(/, "Use ESM source imports; CommonJS require can hide mobile-incompatible dependencies.");
  check(file, source, /\bBuffer(?:\.|\[|\()/, "Use ArrayBuffer or Uint8Array instead of the Node Buffer API.");
}

const css = await readFile("styles.css", "utf8");
check("styles.css", css, /!important\b/, "Use scoped selector specificity instead of important declarations.");
check("styles.css", css, /:has\s*\(/, "Use explicit component state classes instead of relational selectors.");
// Exact Figma colors belong in shared design-token declarations, never component rules.
const componentCss = css.replace(/^\s*--agentlens-color-[a-z-]+:\s*#[0-9a-fA-F]{3,8};\s*$/gm, "");
check("styles.css", componentCss, /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(/, "Use shared AgentLens design tokens or Obsidian theme variables instead of component-local colors.");
const braces = [...css].reduce((count, character) => count + (character === "{" ? 1 : character === "}" ? -1 : 0), 0);
if (braces !== 0) failures.push(`styles.css: unbalanced braces (${braces}).`);

if (failures.length) throw new Error(`AgentLens lint failed:\n${failures.join("\n")}`);
console.log(`Linted ${sourceFiles.length} source files and styles.css.`);

function check(file, source, pattern, message) {
  if (pattern.test(source)) failures.push(`${file}: ${message}`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}
