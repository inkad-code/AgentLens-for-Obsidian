import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
export default defineConfig([
  { ignores: ["node_modules/**", "dist/**", "releases/**", "main.js", "src/**/*.test.tsx"] },
  ...obsidianmd.configs.recommended,
  { languageOptions: { parserOptions: { projectService: true } }, rules: { "obsidianmd/ui/sentence-case": ["warn", { brands: ["AgentLens", "Auto-Fetch", "Files", "Obsidian", "AgentLens/Inbox"], acronyms: ["API"], enforceCamelCaseLower: true }] } }
]);
