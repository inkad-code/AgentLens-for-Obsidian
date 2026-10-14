import esbuild from "esbuild";
import process from "node:process";
import { apiBaseFor } from "./scripts/api-targets.mjs";

const production = process.argv[2] === "production";
const apiBaseUrl = process.env.AGENTLENS_API_BASE_URL ?? apiBaseFor("production");
const releaseProfile = process.env.AGENTLENS_RELEASE_PROFILE ?? "single-fetch-review";
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  banner: { js: `/* AgentLens release profile: ${releaseProfile} */` },
  external: [
    "node:*",
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr"
  ],
  format: "cjs",
  target: "es2018",
  loader: {
    ".png": "dataurl",
    ".svg": "dataurl"
  },
  logLevel: "info",
  minify: production,
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  jsx: "automatic",
  define: {
    "process.env.AGENTLENS_RELEASE_PROFILE": JSON.stringify(releaseProfile),
    "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
    "process.env.AGENTLENS_API_BASE_URL": JSON.stringify(apiBaseUrl)
  }
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
