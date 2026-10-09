import { mkdirSync, writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { account, candidate, candidateSnapshot } from './fixtures/readabilityWorkspace';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

interface LoginFrame {
  readonly ms: number;
  readonly login: boolean;
  readonly wizard: boolean;
  readonly sessionSkeleton: boolean;
  readonly cabinet: boolean;
  readonly profileSkeleton: boolean;
}

test('shows no onboarding flash for a server-confirmed completed profile', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'baseline uses one desktop runner');
  mkdirSync('output/B426', { recursive: true });
  await mockSignedInCabinet(page);
  await page.addInitScript(
    ({ candidateId, cachedProfile }) => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.sessionStorage.setItem(
        `openqareer:cabinet:v1:${encodeURIComponent(candidateId)}`,
        JSON.stringify(cachedProfile),
      );
    },
    {
      candidateId: candidate.candidateId,
      cachedProfile: {
        version: 1,
        candidateId: candidate.candidateId,
        account,
        snapshot: candidateSnapshot,
      },
    },
  );

  let signedIn = false;
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ json: { data: signedIn ? candidate : null } }),
  );
  await page.route('**/api/v1/auth/login', async (route) => {
    signedIn = true;
    return route.fulfill({
      json: {
        data: {
          ...candidate,
          sessionToken: 'synthetic-b426-session',
        },
      },
    });
  });
  await page.route('**/api/v1/candidate/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route.fallback();
  });

  const loginStartedAt = Date.now();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Email или логин')).toBeVisible();
  const loginPageReadyMs = Date.now() - loginStartedAt;
  const assetPaths = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname)
      .filter((path) => path.startsWith('/assets/') && /\.(?:js|mjs|css)$/u.test(path)),
  );
  const initialAssets = [...new Set(assetPaths)].flatMap((path) => {
    const filePath = resolve('dist', `.${path}`);
    if (!existsSync(filePath)) return [];
    const bytes = readFileSync(filePath);
    return [{ path, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length }];
  });
  await page.getByLabel('Email или логин').fill(candidate.username);
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-password-for-e2e');
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
  );
  const signInStartedAt = Date.now();
  await page.getByRole('button', { name: 'Войти в кабинет' }).click();
  expect((await loginResponse).status()).toBe(200);
  await page.waitForURL('**/app');
  const appLoadOffsetMs = Date.now() - signInStartedAt;

  await page.evaluate((offsetMs) => {
    const browserWindow = window as Window & { __b426Frames?: LoginFrame[] };
    const started = performance.now();
    const frames: LoginFrame[] = [];
    browserWindow.__b426Frames = frames;
    const isVisible = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
      );
    };
    const sample = () => {
      frames.push({
        ms: offsetMs + Math.round(performance.now() - started),
        login: isVisible('.auth-page-container'),
        wizard: isVisible('.career-intake'),
        sessionSkeleton: isVisible('.career-session-gate .career-today-skeleton'),
        cabinet: isVisible('.career-cabinet'),
        profileSkeleton: isVisible('.career-cabinet .career-today-skeleton'),
      });
      if (offsetMs + performance.now() - started < 2500) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, appLoadOffsetMs);
  await page.waitForTimeout(2600);
  const frames = await page.evaluate(
    () => (window as Window & { __b426Frames?: LoginFrame[] }).__b426Frames ?? [],
  );
  const after = {
    loginPageReadyMs,
    initialAssets: {
      files: initialAssets.length,
      jsFiles: initialAssets.filter((asset) => /\.m?js$/u.test(asset.path)).length,
      cssFiles: initialAssets.filter((asset) => /\.css$/u.test(asset.path)).length,
      rawBytes: initialAssets.reduce((total, asset) => total + asset.rawBytes, 0),
      gzipBytes: initialAssets.reduce((total, asset) => total + asset.gzipBytes, 0),
    },
    sampledFrames: frames.length,
    wizardFrames: frames.filter((frame) => frame.wizard).length,
    firstWizardMs: frames.find((frame) => frame.wizard)?.ms ?? null,
    firstCabinetMs: frames.find((frame) => frame.cabinet)?.ms ?? null,
    firstFrames: frames.slice(0, 8),
    lastFrames: frames.slice(-4),
    frames,
  };
  writeFileSync('output/B426/login-transition-after.json', JSON.stringify(after, null, 2));
  expect(frames.length).toBeGreaterThan(0);
  expect(after.wizardFrames).toBe(0);
  expect(after.firstCabinetMs).toBeLessThan(2000);
  expect(frames.find((frame) => frame.cabinet)?.profileSkeleton).toBe(false);
});

test('keeps the session skeleton until the server confirms onboarding is incomplete', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'onboarding order uses one desktop runner');
  await mockSignedInCabinet(page);
  await page.addInitScript(() => window.localStorage.clear());

  let signedIn = false;
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ json: { data: signedIn ? candidate : null } }),
  );
  await page.route('**/api/v1/auth/login', async (route) => {
    signedIn = true;
    return route.fulfill({
      json: { data: { ...candidate, sessionToken: 'synthetic-b426-session' } },
    });
  });

  let resolveWorkspace!: () => void;
  let workspaceRequested = false;
  const workspaceGate = new Promise<void>((resolve) => {
    resolveWorkspace = resolve;
  });
  await page.route('**/api/v1/candidate/workspace', async (route) => {
    workspaceRequested = true;
    await workspaceGate;
    await route.fulfill({ json: { data: null } });
  });

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email или логин').fill(candidate.username);
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-password-for-e2e');
  await page.getByRole('button', { name: 'Войти в кабинет' }).click();
  await page.waitForURL('**/app');
  await expect.poll(() => workspaceRequested).toBe(true);
  await expect(page.locator('.career-session-gate .career-today-skeleton')).toBeVisible();
  await expect(page.locator('.career-intake')).toHaveCount(0);

  resolveWorkspace();
  await expect(page.locator('.career-intake')).toBeVisible();
  await expect(page.locator('.career-session-gate .career-today-skeleton')).toHaveCount(0);
});

test('preloads the login page chunk when a landing login link receives focus', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'chunk preload uses one desktop runner');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const loginLink = page.getByRole('link', { name: 'Войти в кабинет' });
  await expect(loginLink).toBeVisible();
  const before = await page.evaluate(
    () =>
      new Set(
        performance
          .getEntriesByType('resource')
          .map((entry) => new URL(entry.name).pathname)
          .filter((path) => path.startsWith('/assets/') && /\.m?js$/u.test(path)),
      ).size,
  );

  await loginLink.focus();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Set(
            performance
              .getEntriesByType('resource')
              .map((entry) => new URL(entry.name).pathname)
              .filter((path) => path.startsWith('/assets/') && /\.m?js$/u.test(path)),
          ).size,
      ),
    )
    .toBeGreaterThan(before);
});

test('clears the candidate-scoped profile cache after sign-out', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'sign-out cache uses one desktop runner');
  await mockSignedInCabinet(page);
  await page.addInitScript(
    ({ candidateId, value }) => {
      sessionStorage.setItem(
        `openqareer:cabinet:v1:${encodeURIComponent(candidateId)}`,
        JSON.stringify(value),
      );
    },
    {
      candidateId: candidate.candidateId,
      value: {
        version: 1,
        candidateId: candidate.candidateId,
        account,
        snapshot: candidateSnapshot,
      },
    },
  );

  let signedIn = false;
  await page.route('**/api/v1/auth/me', async (route) =>
    route.fulfill({ json: { data: signedIn ? candidate : null } }),
  );
  await page.route('**/api/v1/auth/login', async (route) => {
    signedIn = true;
    return route.fulfill({
      json: { data: { ...candidate, sessionToken: 'synthetic-b426-session' } },
    });
  });
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ json: { data: null } }));

  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email или логин').fill(candidate.username);
  await page.getByLabel('Пароль', { exact: true }).fill('synthetic-password-for-e2e');
  await page.getByRole('button', { name: 'Войти в кабинет' }).click();
  await page.waitForURL('**/app');
  await expect(page.locator('.career-cabinet')).toBeVisible();
  await page.locator('.career-account-button').click();
  const accountDialog = page.getByRole('dialog', { name: 'Аккаунт' });
  await expect(accountDialog).toBeVisible();
  await accountDialog.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL('/');

  const cachedValue = await page.evaluate(
    (candidateId) =>
      sessionStorage.getItem(`openqareer:cabinet:v1:${encodeURIComponent(candidateId)}`),
    candidate.candidateId,
  );
  expect(cachedValue).toBeNull();
});

test('keeps the login page usable at desktop and phone widths', async ({ page }, testInfo) => {
  mkdirSync('output/B426', { recursive: true });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Email или логин')).toBeVisible();

  const originalViewport = page.viewportSize();
  expect(originalViewport).not.toBeNull();
  await page.setViewportSize({ width: 280, height: originalViewport?.height ?? 844 });
  const overflowsAt280 = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflowsAt280).toBe(false);
  if (originalViewport) await page.setViewportSize(originalViewport);

  await page.screenshot({
    path: `output/B426/login-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
