import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { installDesktopApiTestBridge } from '../scripts/desktop-api-test-bridge.mjs';
import { openAccountFromShell } from './helpers/open-account';

const TEST_CONNECTION = {
  platform: 'hh',
  available: false,
  status: 'disconnected',
  capabilities: [],
  importsCareerHistory: true,
};

test.describe('B464 browser connector window', () => {
  // Owner rule 24.10: the browser cannot read the provider page after sign-in, so it offers
  // no sign-in window at all — only the state of each platform (the window lives in the .app).
  test('the browser shows platform state without a sign-in path it cannot finish', async ({ page }) => {
    const unmatched = await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/connections', (route) =>
      route.fulfill({
        json: { data: [TEST_CONNECTION, { ...TEST_CONNECTION, platform: 'linkedin' }] },
      }),
    );
    let popups = 0;
    page.on('popup', () => {
      popups += 1;
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openAccountFromShell(page);
    const account = page.getByTestId('career-shell').getByRole('main');
    if ((page.viewportSize()?.width ?? 1440) <= 760) {
      await account.getByRole('button', { name: 'Назад' }).click();
      await account.getByRole('button', { name: 'Подключения' }).click();
      await expect(account.getByText('hh.ru', { exact: true })).toBeVisible();
      await expect(account.getByRole('button', { name: /hh\.ru/u })).toHaveCount(0);
      await expect(account.getByRole('button', { name: /LinkedIn/u })).toHaveCount(0);
    } else {
      await account.getByRole('tab', { name: 'Подключения' }).click();
      await expect(account.getByText('hh.ru', { exact: true })).toBeVisible();
      await expect(account.getByRole('button', { name: /Открыть окно входа/u })).toHaveCount(0);
    }
    await expect(page.getByRole('dialog', { name: /Подключение/u })).toHaveCount(0);
    expect(popups).toBe(0);
    expect(unmatched).toEqual([]);
  });

  test('labels a provider login page as an expired saved session and leaves it open for re-entry', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1440',
      'native session inspection runs in desktop project',
    );
    await page.addInitScript(installDesktopApiTestBridge);
    await page.addInitScript(() => {
      localStorage.setItem('openqareer_session_token', 'desktop-e2e-session');
      let sessionOpen = false;
      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
        {
          invoke: (command: string) => {
            if (command === 'probe_network_status') {
              return Promise.resolve({
                linkedin: { platform: 'linkedin', target_url: '', accessible: true },
                hh: { platform: 'hh', target_url: '', accessible: true },
                recommendation: 'direct',
                probed_at: new Date().toISOString(),
              });
            }
            if (command === 'open_connector_session') {
              sessionOpen = true;
              return Promise.resolve({ opened: true, label: 'connector-hh', reason: null });
            }
            if (command === 'is_connector_session_open' || command === 'show_connector_session') {
              return Promise.resolve(sessionOpen);
            }
            if (command === 'close_connector_session') {
              sessionOpen = false;
              return Promise.resolve(true);
            }
            if (command === 'resize_connector_session') return Promise.resolve(true);
            if (command === 'inspect_connector_session_page') {
              return Promise.resolve({
                ready: true,
                url: 'https://hh.ru/account/login',
                signedInApplicant: false,
                login: true,
                otp: false,
                captcha: false,
              });
            }
            return Promise.resolve(null);
          },
        };
    });
    const unmatched = await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/connections', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              ...TEST_CONNECTION,
              status: 'connected',
              accessMode: 'native_session_snapshot',
              connectedAt: '2026-10-09T12:00:00.000Z',
              lastImportedAt: '2026-10-09T12:00:00.000Z',
            },
          ],
        },
      }),
    );

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openAccountFromShell(page);
    const account = page.getByTestId('career-shell').getByRole('main');
    await account.getByRole('tab', { name: 'Подключения' }).click();
    await account.getByRole('button', { name: 'Управлять' }).click();
    await page
      .getByRole('dialog', { name: 'hh.ru' })
      .getByRole('button', { name: 'Повторить импорт' })
      .click();

    const dialog = page.getByRole('dialog', { name: 'Подключение hh.ru' });
    await expect(
      dialog.getByText('Сессия hh.ru истекла. Войдите снова в открытом окне.'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Показать окно', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await expect(dialog.getByText('Подключено', { exact: true })).toHaveCount(0);
    expect(unmatched).toEqual([]);
  });
});
