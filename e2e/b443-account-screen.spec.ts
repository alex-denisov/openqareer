import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Route } from '@playwright/test';
import type { CandidateConnection } from '../src/features/coach/coachApi';
import { installDesktopApiTestBridge } from '../scripts/desktop-api-test-bridge.mjs';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { openAccountFromShell } from './helpers/open-account';

const EVIDENCE_DIR = e2eEvidenceDirectory('AUD-8');

const accountConnections: CandidateConnection[] = [
  {
    platform: 'linkedin',
    available: true,
    capabilities: ['profile_read'],
    importsCareerHistory: true,
    status: 'connected',
    accessMode: 'native_session_snapshot',
    connectedAt: '2026-10-10T08:00:00.000Z',
    lastImportedAt: '2026-10-12T08:00:00.000Z',
    factCount: 12,
  },
  {
    platform: 'hh',
    available: true,
    capabilities: ['profile_read', 'resume_read'],
    importsCareerHistory: true,
    status: 'connected',
    accessMode: 'native_session_snapshot',
    connectedAt: '2026-10-11T08:00:00.000Z',
    lastImportedAt: '2026-10-11T08:10:00.000Z',
    factCount: 8,
  },
];

function accountNotificationHandler() {
  const preferences = [
    'ev-reply',
    'ev-reminder',
    'ev-approval',
    'ev-delivery-error',
    'ev-target-company',
    'ev-weekly-digest',
  ].map((key, index) => ({
    key,
    app: true,
    email: index === 0 || index === 3 || index === 5,
    telegram: false,
  }));
  return async (route: Route, requestPath: string): Promise<boolean> => {
    if (requestPath.endsWith('/notifications/preferences') && route.request().method() === 'GET') {
      await route.fulfill({ json: { data: { events: preferences } } });
      return true;
    }
    if (requestPath.endsWith('/notifications/channels') && route.request().method() === 'GET') {
      await route.fulfill({
        json: {
          data: {
            emailAvailable: true,
            telegram: {
              available: false,
              connected: false,
              linkedAt: null,
              botUsername: 'openqareer_bot',
            },
            mandatory: {
              security: {
                app: true,
                email: true,
                telegram: false,
                locked: true,
                sourceAvailable: true,
              },
              payments: {
                app: true,
                email: true,
                telegram: false,
                locked: true,
                sourceAvailable: true,
              },
            },
          },
        },
      });
      return true;
    }
    return false;
  };
}

function accountConsentHandler() {
  const records = [
    {
      id: 'consent-digital-footprint',
      capability: 'digital_footprint',
      versionId: 'digital_footprint-v1.1',
      grantedAt: '2026-10-01T08:00:00.000Z',
      revokedAt: null as string | null,
    },
  ];
  return async (route: Route): Promise<void> => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me/consents') && route.request().method() === 'GET') {
      await route.fulfill({ json: { data: { consents: records } } });
      return;
    }
    if (path.endsWith('/digital_footprint') && route.request().method() === 'DELETE') {
      records[0]!.revokedAt = '2026-10-13T08:00:00.000Z';
      await route.fulfill({
        json: {
          data: {
            capability: 'digital_footprint',
            granted: false,
            revoked: true,
            consent: records[0],
          },
        },
      });
      return;
    }
    await route.fallback();
  };
}

async function openAccount(page: import('@playwright/test').Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openAccountFromShell(page);
  const account = page.getByTestId('career-shell').getByRole('main');
  await expect(account).toBeVisible({ timeout: 15_000 });
  if ((page.viewportSize()?.width ?? 1440) > 760) {
    await expect(account.getByRole('heading', { name: 'Аккаунт' })).toBeVisible();
  }
  return account;
}

async function captureAtContentHeight(page: import('@playwright/test').Page, fileName: string) {
  const width = page.viewportSize()?.width ?? 1440;
  const viewportHeight = page.viewportSize()?.height ?? 900;
  const contentHeight = await page
    .locator('#career-main')
    .evaluate((element) => Math.ceil(element.scrollHeight));
  await page.setViewportSize({ width, height: Math.max(viewportHeight, contentHeight, 1) });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, fileName), fullPage: true });
}

async function captureAuditHtml(page: import('@playwright/test').Page, fileName: string) {
  const html = await page.evaluate(() => {
    const styles = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules, (rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    const snapshot = document.documentElement.cloneNode(true) as HTMLHtmlElement;
    snapshot
      .querySelectorAll('script, link[rel~="stylesheet"], link[rel="modulepreload"]')
      .forEach((element) => element.remove());
    const style = document.createElement('style');
    style.textContent = styles;
    snapshot.querySelector('head')?.append(style);
    return `<!doctype html>${snapshot.outerHTML}`;
  });
  writeFileSync(path.join(EVIDENCE_DIR, fileName), html);
}

test.describe('B443: Account screen in the signed-in shell', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSignedInCabinet(page, {
      accountConnections,
      accountNotificationHandler: accountNotificationHandler(),
    });
  });

  test('desktop screen uses live account data across tabs and captures shell evidence', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await page.route('**/api/v1/me/consents**', accountConsentHandler());
    const account = await openAccount(page);
    await expect(account.getByRole('tab', { name: 'Профиль и вход' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    for (const tabName of [
      'Профиль и вход',
      /Подключения 3 из 6/u,
      'Уведомления',
      'Согласия и данные',
      'Подписка и платежи',
    ]) {
      await expect(account.getByRole('tab', { name: tabName })).toBeVisible();
    }
    await expect(account.getByRole('tab', { name: 'Приложение' })).toHaveCount(0);
    await expect(account.getByText('Мария Соколова')).toBeVisible();
    await expect(account.getByText('qa-readability@example.com')).toBeVisible();
    await expect(account.getByText('Europe/Moscow')).toBeVisible();
    await expect(account.getByText('Эта сессия')).toBeVisible();
    await expect(account.getByText('Текущее устройство')).toBeVisible();
    await expect(account.getByText('Андрей Лебедев')).toHaveCount(0);
    await captureAtContentHeight(page, 'account-desktop-1440-profile.png');
    await captureAuditHtml(page, 'account-desktop-1440-profile.html');

    await account.getByRole('tab', { name: /Подключения 3 из 6/u }).click();
    await expect(account.getByText('Импортировано 12 фактов')).toBeVisible();
    await account.getByRole('button', { name: 'Управлять' }).first().click();
    const linkedinDialog = page.getByRole('dialog', { name: 'LinkedIn' });
    await expect(linkedinDialog.getByText('Импортировано 12 фактов')).toBeVisible();
    await expect(
      linkedinDialog.getByRole('checkbox', {
        name: 'Использовать контакты для маршрутов к компаниям',
      }),
    ).toBeDisabled();
    await captureAtContentHeight(page, 'account-desktop-1440-manage-linkedin.png');
    await linkedinDialog.getByRole('button', { name: 'Закрыть' }).click();
    await account.getByRole('button', { name: 'Управлять' }).nth(1).click();
    const hhDialog = page.getByRole('dialog', { name: 'hh.ru' });
    await expect(hhDialog.getByText('Импортировано 8 фактов')).toBeVisible();
    await captureAtContentHeight(page, 'account-desktop-1440-manage-hh.png');
    await hhDialog.getByRole('button', { name: 'Закрыть' }).click();
    await captureAtContentHeight(page, 'account-desktop-1440-connections.png');
    await captureAuditHtml(page, 'account-desktop-1440-connections.html');

    await account.getByRole('tab', { name: 'Уведомления' }).click();
    await expect(
      account.getByRole('cell', { name: 'Ответ работодателя', exact: true }),
    ).toBeVisible();
    await captureAtContentHeight(page, 'account-desktop-1440-notifications.png');
    await captureAuditHtml(page, 'account-desktop-1440-notifications.html');

    await account.getByRole('tab', { name: 'Согласия и данные' }).click();
    await expect(account.getByText('Дано 01.10')).toBeVisible();
    await expect(account.getByText('Удалить аккаунт')).toBeVisible();
    await captureAtContentHeight(page, 'account-desktop-1440-consents.png');
    await captureAuditHtml(page, 'account-desktop-1440-consents.html');
    await account.getByRole('button', { name: 'Отозвать' }).click();
    const consentDialog = page.getByRole('alertdialog', { name: 'Отозвать согласие?' });
    await consentDialog.getByRole('button', { name: 'Отозвать согласие' }).click();
    await expect(account.getByText('Не дано').first()).toBeVisible();

    await account.getByRole('tab', { name: 'Подписка и платежи' }).click();
    await expect(account.getByText('Подписка и платежи')).toBeVisible();
    await captureAtContentHeight(page, 'account-desktop-1440-payments.png');
    await captureAuditHtml(page, 'account-desktop-1440-payments.html');
  });

  test('desktop profile actions save the display name and update the confirmed address', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    const account = await openAccount(page);
    const profileEdits = account.getByRole('button', { name: 'Изменить', exact: true });
    await profileEdits.nth(0).click();
    const nameDialog = page.getByRole('dialog', { name: 'Изменить имя' });
    await nameDialog.getByLabel('Имя').fill('Мария Новая');
    await nameDialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(account.getByText('Мария Новая')).toBeVisible();

    await account.getByRole('button', { name: 'Изменить', exact: true }).nth(1).click();
    const emailDialog = page.getByRole('dialog', { name: 'Изменить почту для входа' });
    await emailDialog.getByLabel('Новый email').fill('maria.new@example.test');
    await emailDialog.getByLabel('Текущий пароль').fill('current-password-e2e');
    await emailDialog.getByRole('button', { name: 'Отправить код' }).click();
    await expect(account.getByText('maria.new@example.test')).toBeVisible();
  });

  test('the desktop app exposes version settings while the browser hides them', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    const trigger = page.getByRole('button', { name: 'Открыть аккаунт' });
    await expect(trigger).toBeEnabled({ timeout: 15_000 });
    await page.evaluate(installDesktopApiTestBridge);
    await page.evaluate(() => {
      (window as unknown as { __TAURI_INTERNALS__: Record<string, unknown> }).__TAURI_INTERNALS__ =
        {};
    });
    await trigger.click();
    const account = page.getByTestId('career-shell').getByRole('main');
    await expect(account.getByRole('heading', { name: 'Аккаунт' })).toBeVisible();
    const appTab = account.getByRole('tab', { name: 'Приложение' });
    await expect(appTab).toBeVisible();
    await appTab.click();
    await expect(account.getByText(/openqareer \d+\.\d+\.\d+/u)).toBeVisible();
    await expect(account.getByText('Сборка не помечена')).toHaveCount(0);
    await captureAtContentHeight(page, 'account-desktop-app-1440.png');
    await captureAuditHtml(page, 'account-desktop-app-1440.html');
  });

  test('mobile account keeps the approved compact connections view without app settings', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Mobile 390 only');
    await page.setViewportSize({ width: 390, height: 844 });
    const account = await openAccount(page);
    await expect(account.getByRole('tab', { name: 'Приложение' })).toHaveCount(0);
    await account.getByRole('button', { name: 'Назад' }).click();
    await account.getByRole('button', { name: /Подключения/u }).click();
    await expect(account.getByRole('heading', { name: 'Подключения' })).toBeVisible();
    await expect(account.getByText('LinkedIn')).toBeVisible();
    await expect(account.getByText('hh.ru')).toBeVisible();
    await expect(account.getByText('Импортировано 12 фактов')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await captureAtContentHeight(page, 'account-mobile-390-connections.png');
    await captureAuditHtml(page, 'account-mobile-390-connections.html');
  });
});

test.describe('B443: Account screen with the Pro plan', () => {
  test.beforeEach(async ({ page }) => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockSignedInCabinet(page, {
      accountConnections,
      billing: { initialPlan: 'pro' },
    });
  });

  test('subscription evidence uses the persisted plan state', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
    const account = await openAccount(page);
    await account.getByRole('tab', { name: 'Подписка и платежи' }).click();
    await expect(account.getByRole('heading', { name: 'Pro' })).toBeVisible();
    await captureAtContentHeight(page, 'account-desktop-1440-payments-pro.png');
    await captureAuditHtml(page, 'account-desktop-1440-payments-pro.html');
  });
});
