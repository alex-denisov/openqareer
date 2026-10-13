import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';
import { installDesktopApiTestBridge } from '../scripts/desktop-api-test-bridge.mjs';

const CANDIDATE = {
  username: 'diagnostic.candidate',
  email: 'diagnostic.candidate@example.test',
  displayName: 'Диагностика',
  role: 'candidate' as const,
  isTest: false,
  candidateId: 'candidate-b229',
};

test.describe('S11 FirstRun session continuity', () => {
  test('a signed-in candidate without a workspace opens FirstRun', async ({ page }) => {
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/auth/me') {
        await route.fulfill({ json: { data: CANDIDATE } });
      } else if (path === '/api/v1/candidate/workspace') {
        await route.fulfill({ json: { data: null } });
      } else {
        await route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      }
    });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();
    await expect(page.getByText('Находка себя')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Карьерный кабинет' })).toHaveCount(0);
  });

  test('a session restored after two seconds still opens FirstRun', async ({ page }) => {
    await page.addInitScript(installDesktopApiTestBridge);
    await page.addInitScript(() => {
      Object.assign(window, { __TAURI_INTERNALS__: { invoke: async () => null } });
      localStorage.setItem('openqareer_session_token', 'desktop-restored-session');
    });
    let reads = 0;
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/auth/me') {
        reads += 1;
        await delay(2_500);
        await route.fulfill({ json: { data: CANDIDATE } });
      } else if (path === '/api/v1/candidate/workspace') {
        await route.fulfill({ json: { data: null } });
      } else {
        await route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      }
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    for (const reload of [false, true]) {
      if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('first-run-wizard')).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/app$/);
    }
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => localStorage.getItem('openqareer_session_token'))).toBe(
      'desktop-restored-session',
    );
  });

  test('a delayed old session cannot replace a newly signed-in candidate', async ({ page }) => {
    const nextCandidate = {
      ...CANDIDATE,
      candidateId: 'candidate-b229-next',
      displayName: 'Новый кандидат',
      email: 'next@example.test',
    };
    let signedIn = false;
    let holdOldRead = true;
    let releaseOldRead!: () => void;
    let reportOldRead!: () => void;
    const oldReadStarted = new Promise<void>((resolve) => {
      reportOldRead = resolve;
    });
    const oldReadGate = new Promise<void>((resolve) => {
      releaseOldRead = resolve;
    });

    await page.addInitScript(() => {
      localStorage.setItem('openqareer_session_token', 'desktop-restored-session');
    });
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/v1/auth/me') {
        const responseUser = signedIn ? nextCandidate : CANDIDATE;
        if (holdOldRead && !signedIn) {
          reportOldRead();
          await oldReadGate;
        }
        await route.fulfill({ json: { data: responseUser } });
      } else if (path === '/api/v1/auth/login' && request.method() === 'POST') {
        signedIn = true;
        await route.fulfill({
          json: { data: { ...nextCandidate, sessionToken: 'desktop-next-session' } },
        });
      } else if (path === '/api/v1/candidate/workspace') {
        await route.fulfill({ json: { data: null } });
      } else {
        await route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
      }
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      history.pushState(null, '', '/login');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await oldReadStarted;
    await page.getByLabel('Email или логин').fill(nextCandidate.email);
    await page.getByLabel('Пароль', { exact: true }).fill('synthetic-passphrase-2026');
    const workspaceRequest = page.waitForRequest((request) =>
      request.url().includes('/api/v1/candidate/workspace'),
    );
    await page.getByRole('button', { name: 'Войти в кабинет' }).click();
    await expect(page).toHaveURL(/\/app$/);
    expect((await workspaceRequest).headers()['authorization']).toBe('Bearer desktop-next-session');
    const oldResponse = page.waitForResponse((response) => response.url().endsWith('/auth/me'));
    releaseOldRead();
    holdOldRead = false;
    await oldResponse;
    await expect(page.getByTestId('first-run-wizard')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('openqareer_session_token'))).toBe(
      'desktop-next-session',
    );
  });
});
