import { defineConfig } from '@playwright/test';
const previewUrl = `http://127.0.0.1:${process.env.AGENTLENS_UI_PORT || '4173'}`;
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: { baseURL: previewUrl, channel: 'chrome', headless: true, screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/ui-preview.mjs', url: previewUrl, reuseExistingServer: false },
  outputDir: 'dist/browser-results'
});
