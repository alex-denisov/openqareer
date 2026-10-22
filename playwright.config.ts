import { defineConfig, devices } from '@playwright/test';

// Параллельные агенты в разных worktree задают свой порт, чтобы не делить превью.
const port = Number(process.env.E2E_PORT ?? 4173);
// WebKit specs (the .app renders in WKWebView) run in their own macOS CI job:
// WebKit's apt deps on Ubuntu runners stall and failed the Chromium shards.
const WEBKIT_SPECS = ['**/*-b446r.spec.ts', '**/*-b549r.spec.ts'];
const webkitOnly = process.env.E2E_WEBKIT === 'only';
const webkitSkipped = process.env.E2E_WEBKIT === 'skip';

export default defineConfig({
  testDir: './e2e',
  ...(webkitOnly ? { testMatch: WEBKIT_SPECS } : {}),
  ...(webkitSkipped ? { testIgnore: WEBKIT_SPECS } : {}),
  fullyParallel: false,
  // The built shell loads split chunks on first use; two workers keep cold-start UI gates stable.
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-1440',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'mobile-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
