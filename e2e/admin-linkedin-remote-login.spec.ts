import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * B373 — вход в аккаунт пула LinkedIn через браузер сервера. Ответы сервера
 * подменены: проверяется панель, пересчёт клика и закрытие по Escape.
 */

const ACCOUNT_ID = '2e6f2b8a-1e84-4f07-9c6d-f8b5a4e2e4a1';
const BASE = `**/api/v1/admin/linkedin/accounts/${ACCOUNT_ID}/remote-login`;
// 1x1 JPEG, растягивается на ширину панели.
const PIXEL =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

async function stubAdminPool(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        data: {
          username: 'admin.test',
          email: 'admin@example.com',
          displayName: 'Администратор',
          role: 'admin',
          isTest: false,
          candidateId: null,
        },
      },
    }),
  );
  await page.route('**/api/v1/admin/users*', (route) =>
    route.fulfill({ json: { data: { total: 0, users: [] } } }),
  );
  await page.route('**/api/v1/admin/linkedin/accounts?*', (route) =>
    route.fulfill({
      json: {
        data: {
          total: 1,
          offset: 0,
          nextOffset: null,
          accounts: [
            {
              id: ACCOUNT_ID,
              adminLabel: 'Основной пул',
              emailLogin: 'pool-admin@example.test',
              providerAccountMarker: null,
              profileIsolationId: 'profile-1',
              state: 'login_required',
              lastVerifiedAt: null,
              lastHeartbeatAt: null,
              lastFailureCode: 'login_required',
              leaseUntil: null,
              capabilityVerdict: 'not_configured',
              revision: 0,
              createdAt: '2026-09-22T00:00:00.000Z',
              updatedAt: '2026-09-22T00:00:00.000Z',
              serverSession: null,
            },
          ],
        },
      },
    }),
  );
}

async function openPool(page: Page): Promise<void> {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page.getByRole('button', { name: 'Аккаунты LinkedIn' }).click();
  await page.getByRole('button', { name: /pool-admin@example.test/ }).click();
}

test.describe('B373 remote LinkedIn login panel', () => {
  test('shows the server screen, sends a scaled click and closes on Escape', async ({ page }) => {
    const inputs: unknown[] = [];
    let deleted = 0;
    let state: 'login' | 'checkpoint' = 'login';
    await stubAdminPool(page);
    await page.route(BASE, (route) =>
      route.fulfill({ status: 201, json: { data: { loginId: 'login-1' } } }),
    );
    await page.route(`${BASE}/login-1/frame`, (route) =>
      route.fulfill({
        json: {
          data: {
            state,
            url: 'https://www.linkedin.com/login',
            imageBase64: PIXEL,
            width: 1440,
            height: 900,
            capturedAt: '2026-10-05T10:00:00.000Z',
            reason: null,
          },
        },
      }),
    );
    await page.route(`${BASE}/login-1/input`, (route) => {
      inputs.push(route.request().postDataJSON());
      return route.fulfill({ status: 204 });
    });
    await page.route(`${BASE}/login-1`, (route) => {
      if (route.request().method() === 'DELETE') deleted += 1;
      return route.fulfill({ status: 204 });
    });

    await openPool(page);
    await expect(page.getByRole('button', { name: /Перенести из приложения/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Войти в браузере сервера' }).click();
    const dialog = page.getByRole('dialog', { name: /Вход в браузере сервера/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Страница входа LinkedIn');

    state = 'checkpoint';
    await expect(dialog).toContainText('LinkedIn просит проверку — пройдите её здесь');

    const image = dialog.getByRole('img', { name: 'Экран браузера на сервере' });
    await expect(image).toBeVisible();
    const box = (await image.boundingBox())!;
    await image.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await expect.poll(() => inputs.length).toBeGreaterThan(0);
    const click = inputs[0] as { type: string; x: number; y: number };
    expect(click.type).toBe('click');
    expect(Math.abs(click.x - 720)).toBeLessThanOrEqual(3);
    expect(Math.abs(click.y - 450)).toBeLessThanOrEqual(3);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    mkdirSync('output/playwright/B373', { recursive: true });
    await page.screenshot({ path: 'output/playwright/B373/remote-login-1440.png' });

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(deleted).toBe(1);
  });

  test('shows a start error as text and opens no panel', async ({ page }) => {
    await stubAdminPool(page);
    await page.route(BASE, (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: { code: 'linkedin_profile_busy', message: 'Профиль занят', retryable: false },
        },
      }),
    );
    await openPool(page);
    await page.getByRole('button', { name: 'Войти в браузере сервера' }).click();
    await expect(page.getByRole('alert')).toContainText('занят');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
