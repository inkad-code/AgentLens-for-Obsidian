import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { apiBaseFor } from "./api-targets.mjs";
import { embedAuthHero } from "./embed-auth-hero.mjs";

await embedAuthHero();

const target = process.argv.find((argument) => argument.startsWith("--target="))?.slice("--target=".length) ?? "production";
const apiBaseUrl = apiBaseFor(target);
const profile = process.argv.find(argument => argument.startsWith("--profile="))?.slice("--profile=".length) ?? "single-fetch-review";
if (!["full", "single-fetch-review"].includes(profile)) throw new Error("Unknown release profile.");
const root = fileURLToPath(new URL("..", import.meta.url));
const typescript = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
const environment = { ...process.env, AGENTLENS_API_BASE_URL: apiBaseUrl, AGENTLENS_RELEASE_PROFILE: profile };

execFileSync(process.execPath, [typescript, "--noEmit", "--skipLibCheck"], { cwd: root, env: environment, stdio: "inherit" });
execFileSync(process.execPath, ["esbuild.config.mjs", "production"], { cwd: root, env: environment, stdio: "inherit" });
