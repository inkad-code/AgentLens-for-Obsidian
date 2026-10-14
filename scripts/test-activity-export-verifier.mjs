import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentlens-activity-export-"));
try {
  const safe = {
    schema: "obsidian-activity-v1",
    generatedAt: "2026-08-20T07:00:00Z",
    retentionDays: 90,
    retainedFrom: "2026-05-22T00:00:00Z",
    truncated: false,
    items: [{
      summary: {
        activityId: "activity-1", operation: "single_fetch", platform: "youtube",
        targetAlias: "youtube.com", occurredAt: "2026-08-20T06:55:00Z", result: "failed",
        chargedUnits: 0, relativeNotePath: null, fileCount: 0, deleted: false
      },
      diagnostics: {
        requestId: "request-1", fetchId: null, runId: null, cursorRef: null,
        pageNumber: null, trigger: null, chargedUnits: 0, reusedExisting: false,
        errorCode: "UPSTREAM_TIMEOUT", errorSummary: "Request failed (UPSTREAM_TIMEOUT)."
      }
    }]
  };
  const safePath = join(directory, "safe.json");
  await writeFile(safePath, JSON.stringify(safe));
  const output = run(safePath);
  if (!output.includes("1 item(s), 0 charged unit(s), 1 failed")) throw new Error("safe fixture summary was not verified");
  for (const relativeNotePath of ["AgentLens/Acceptance/", "收藏/👩🏽‍💻-🚀.md", "."]) {
    const fixture = structuredClone(safe);
    fixture.items[0].summary.relativeNotePath = relativeNotePath;
    await writeFile(safePath, JSON.stringify(fixture));
    run(safePath);
  }

  const attacks = [
    { name: "unknown-operation", mutate: (value) => { value.items[0].summary.operation = "unknown"; } },
    { name: "extra-secret-key", mutate: (value) => { value.items[0].refreshToken = "secret"; } },
    { name: "absolute-path", mutate: (value) => { value.items[0].summary.relativeNotePath = "/Users/private/note.md"; } },
    { name: "traversal-directory", mutate: (value) => { value.items[0].summary.relativeNotePath = "AgentLens/../private/"; } },
    { name: "empty-directory-segment", mutate: (value) => { value.items[0].summary.relativeNotePath = "AgentLens//"; } },
    { name: "bearer-summary", mutate: (value) => { value.items[0].diagnostics.errorSummary = "Bearer secret"; } },
    { name: "signed-query", mutate: (value) => { value.items[0].summary.targetAlias = "cdn.example/file?signature=secret"; } },
    { name: "charged-mismatch", mutate: (value) => { value.items[0].diagnostics.chargedUnits = 1; } }
  ];
  for (const attack of attacks) {
    const hostile = structuredClone(safe);
    attack.mutate(hostile);
    const hostilePath = join(directory, `${attack.name}.json`);
    await writeFile(hostilePath, JSON.stringify(hostile));
    let rejected = false;
    try { run(hostilePath); } catch { rejected = true; }
    if (!rejected) throw new Error(`${attack.name} fixture was not rejected`);
  }
  console.log(`Verified Activity export verifier against 4 safe and ${attacks.length} hostile fixture(s).`);
} finally {
  await rm(directory, { recursive: true, force: true });
}

function run(file) {
  return execFileSync(process.execPath, ["scripts/verify-activity-export.mjs", file], {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
}
