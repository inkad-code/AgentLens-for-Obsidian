import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
execFileSync(process.execPath, ["scripts/package-review.mjs"], { cwd: root, stdio: "inherit" });
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const binaries = ["main.js", "manifest.json", "styles.css"];
const documents = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"];
const files = [...binaries, ...documents];
const archiveName = `${manifest.id}-${manifest.version}.zip`;
const output = join(root, "dist", "release", manifest.version);
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "agentlens-release-"));
try {
  for (const name of files) await cp(join(root, name), join(temporary, name));
  const archive = join(temporary, archiveName);
  execFileSync("zip", ["-X", "-q", archive, ...files], { cwd: temporary });
  const listing = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n").sort();
  if (JSON.stringify(listing) !== JSON.stringify([...files].sort())) throw new Error("Unexpected installation ZIP contents.");
  execFileSync("unzip", ["-t", archive], { stdio: "inherit" });
  const extracted = join(temporary, "extracted");
  execFileSync("unzip", ["-q", archive, "-d", extracted]);
  for (const name of files) {
    if (!(await readFile(join(extracted, name))).equals(await readFile(join(root, name)))) {
      throw new Error(`Installation ZIP differs from source: ${name}`);
    }
  }
  for (const name of binaries) await cp(join(root, name), join(output, name));
  await cp(archive, join(output, archiveName));
  const checksums = [];
  for (const name of [...binaries, archiveName]) {
    const digest = createHash("sha256").update(await readFile(join(output, name))).digest("hex");
    checksums.push(`${digest}  ${name}`);
  }
  await writeFile(join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  console.log(`Release assets: ${output}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
