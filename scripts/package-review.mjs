import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = (args, options = {}) => execFileSync(process.execPath, args, { cwd: root, stdio: "inherit", ...options });
run(["scripts/lint.mjs"]);
run(["scripts/test-react-no-scripts.mjs"]);
run(["scripts/build.mjs", "--target=production", "--profile=single-fetch-review"]);
run(["node_modules/vitest/vitest.mjs", "run"], { env: { ...process.env, AGENTLENS_VERIFY_REVIEW_BUNDLE: "1" } });
run(["scripts/test-activity-export-verifier.mjs"]);
run(["scripts/verify-package.mjs", "--target=production", "--profile=single-fetch-review"]);

const files = ["main.js", "manifest.json", "styles.css"];
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim().length > 0;
const name = `agentlens-social-importer-0.1.3-production-single-fetch-review-${stamp}-${sha}${dirty ? "-dirty" : ""}`;
await mkdir(join(root, "releases"), { recursive: true });
const archive = join(root, "releases", `${name}.zip`);
const temporary = await mkdtemp(join(tmpdir(), "agentlens-review-"));
try {
  for (const file of files) await cp(join(root, file), join(temporary, file));
  execFileSync("zip", ["-X", "-q", archive, ...files], { cwd: temporary });
  const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n").sort();
  if (JSON.stringify(listing) !== JSON.stringify([...files].sort())) throw new Error("Unexpected archive contents.");
  execFileSync("unzip", ["-t", archive], { stdio: "inherit" });
  const extracted = join(temporary, "extracted");
  execFileSync("unzip", ["-q", archive, "-d", extracted]);
  for (const file of files) {
    if (!(await readFile(join(extracted, file))).equals(await readFile(join(root, file)))) throw new Error(`Archive differs: ${file}`);
  }
  for (const file of ["package.json", "versions.json"]) await cp(join(root, file), join(extracted, file));
  run([join(root, "scripts/verify-package.mjs"), "--target=production", "--profile=single-fetch-review"], { cwd: extracted });
  const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(`${archive}.sha256`, `${digest}  ${name}.zip\n`);
  console.log(`Review package: ${archive}\nSHA-256: ${digest}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
