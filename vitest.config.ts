import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "obsidian": new URL("./tests/mocks/obsidian.ts", import.meta.url).pathname
    }
  },
  test: {
    environment: "jsdom",
    exclude: ["tests/browser/**", "node_modules/**", "dist/**"],
    setupFiles: ["./tests/setup.ts"],
    clearMocks: true
  }
});
