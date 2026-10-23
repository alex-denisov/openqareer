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
  test('opens the allowlisted login popup, reports an unconfirmed close and retries', async ({
    page,
  }, testInfo) => {
    const unmatched = await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/connections', (route) =>
      route.fulfill({ json: { data: [TEST_CONNECTION] } }),
    );
    await page.context().route('https://hh.ru/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main>Mock hh.ru login page</main>',
      }),
    );

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openAccountFromShell(page);
    const account = page.getByTestId('career-shell').getByRole('main');
    if ((page.viewportSize()?.width ?? 1440) <= 760) {
      await account.getByRole('button', { name: 'Назад' }).click();
      await account.getByRole('button', { name: 'Подключения' }).click();
      await account.getByRole('button', { name: /hh\.ru/u }).click();
    } else {
      await account.getByRole('tab', { name: 'Подключения' }).click();
      await expect(account.getByRole('button', { name: 'Открыть окно входа hh.ru' })).toBeVisible();
      await account.getByRole('button', { name: 'Открыть окно входа hh.ru' }).click();
    }

    const dialog = page.getByRole('dialog', { name: 'Подключение hh.ru' });
    const popupPromise = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: 'Открыть окно входа в hh.ru' }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL('https://hh.ru/account/login');
    // Mockup 12: no address line, only «Ждём вход · Показать окно · Отмена».
    await expect(dialog.getByText('Ждём вход')).toBeVisible();
    await expect(dialog.getByText('https://hh.ru')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Показать окно', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await expect(dialog).toHaveClass(/is-detail/u);
    const activeOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(activeOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('b464-browser-session-open.png') });

    await popup.close();
    await expect(
      dialog.getByText('Окно закрыто, вход не завершён. Подключение не изменилось.'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Подключить снова' })).toBeVisible();
    await expect(dialog.getByText('Подключено', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('b464-browser-session-closed.png') });

    const retryPopupPromise = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: 'Подключить снова' }).click();
    const retryPopup = await retryPopupPromise;
    await expect(retryPopup).toHaveURL('https://hh.ru/account/login');
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => retryPopup.isClosed()).toBe(true);
    expect(unmatched).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('opens the allowlisted LinkedIn login popup, reports an unconfirmed close and retries', async ({
    page,
  }, testInfo) => {
    const unmatched = await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/connections', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              platform: 'linkedin',
              available: false,
              status: 'disconnected',
              capabilities: [],
              importsCareerHistory: false,
            },
          ],
        },
      }),
    );
    await page.context().route('https://www.linkedin.com/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main>Mock LinkedIn login page</main>',
      }),
    );

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await openAccountFromShell(page);
    const account = page.getByTestId('career-shell').getByRole('main');
    if ((page.viewportSize()?.width ?? 1440) <= 760) {
      await account.getByRole('button', { name: 'Назад' }).click();
      await account.getByRole('button', { name: 'Подключения' }).click();
      await account.getByRole('button', { name: /LinkedIn/u }).click();
    } else {
      await account.getByRole('tab', { name: 'Подключения' }).click();
      await expect(
        account.getByRole('button', { name: 'Открыть окно входа LinkedIn' }),
      ).toBeVisible();
      await account.getByRole('button', { name: 'Открыть окно входа LinkedIn' }).click();
    }

    const dialog = page.getByRole('dialog', { name: 'Подключение LinkedIn' });
    const popupPromise = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: 'Открыть окно входа в LinkedIn' }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/linkedin\.com/);
    await expect(dialog.getByText('Ждём вход')).toBeVisible();
    await expect(dialog.getByText('https://www.linkedin.com')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Показать окно', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('b464-linkedin-session-open.png') });

    await popup.close();
    await expect(
      dialog.getByText('Окно закрыто, вход не завершён. Подключение не изменилось.'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Подключить снова' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('b464-linkedin-session-closed.png') });

    const retryPopupPromise = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: 'Подключить снова' }).click();
    const retryPopup = await retryPopupPromise;
    await expect(retryPopup).toHaveURL(/linkedin\.com/);
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => retryPopup.isClosed()).toBe(true);
    expect(unmatched).toEqual([]);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
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
