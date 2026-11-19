import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';
import { acquireTestLock } from './scripts/lib/test-lock.mjs';

// Один Playwright на машину: остальные worktree ждут очереди. Берёт только
// главный процесс раннера; воркеры и webServer видят OQ_LOCK_HELD.
if (!process.env.TEST_WORKER_INDEX && acquireTestLock().acquired)
  process.env.OQ_LOCK_HELD = String(process.pid);

// Параллельные агенты в разных worktree задают свой порт, чтобы не делить превью.
const port = Number(process.env.E2E_PORT ?? 4173);
// WebKit specs (the .app renders in WKWebView) run in their own CI job, in the
// Playwright image: WebKit's apt deps on bare Ubuntu runners stall and failed the
// Chromium shards.
const WEBKIT_SPECS = ['**/*-b446r.spec.ts', '**/*-b549r.spec.ts'];
const webkitOnly = process.env.E2E_WEBKIT === 'only';
// Locally WebKit specs are skipped unless E2E_WEBKIT=only|include; CI sets the
// variable explicitly per job.
const webkitSkipped =
  process.env.E2E_WEBKIT === 'skip' || (!process.env.CI && !process.env.E2E_WEBKIT);
// CI keeps two workers (cold-start UI gates on small runners). Locally half the
// cores: one worker per core timed out shell gates when other sessions loaded
// the Mac (4 of 138 tests at load 227). E2E_WORKERS overrides.
const workers =
  Number(process.env.E2E_WORKERS) ||
  (process.env.CI ? 2 : Math.max(2, Math.floor(os.availableParallelism() / 2)));

export default defineConfig({
  testDir: './e2e',
  ...(webkitOnly ? { testMatch: WEBKIT_SPECS } : {}),
  ...(webkitSkipped ? { testIgnore: WEBKIT_SPECS } : {}),
  fullyParallel: false,
  workers,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // CI also writes JSON so the flaky collector can list retry passes.
  reporter: process.env.CI
    ? [['line'], ['json', { outputFile: 'reports/playwright.json' }]]
    : 'list',
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
