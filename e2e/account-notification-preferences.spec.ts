import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Route } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE_DIR = '/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/evidence/B474';
const PREFERENCE_KEYS = [
  'ev-reply',
  'ev-reminder',
  'ev-approval',
  'ev-delivery-error',
  'ev-target-company',
  'ev-weekly-digest',
] as const;

function createPreferencesHandler() {
  const preferences = PREFERENCE_KEYS.map((key, index) => ({
    key,
    app: true,
    email: index === 0 || index === 3 || index === 5,
    telegram: index === 0 || index === 1 || index === 3,
  }));
  const state = { connected: false, linkIssued: false, telegramStatusChecks: 0, writes: 0 };
  const handler = async (route: Route, path: string): Promise<boolean> => {
    const method = route.request().method();
    if (path.endsWith('/notifications/preferences') && method === 'GET') {
      await route.fulfill({ json: { data: { events: preferences } } });
      return true;
    }
    const preference = path.match(/\/notifications\/preferences\/([^/]+)$/u);
    if (preference && method === 'PUT') {
      const key = decodeURIComponent(preference[1]!);
      const saved = { key, ...(route.request().postDataJSON() as object) };
      const index = preferences.findIndex((item) => item.key === key);
      if (index >= 0) preferences[index] = saved as (typeof preferences)[number];
      state.writes += 1;
      await route.fulfill({ json: { data: saved } });
      return true;
    }
    if (path.endsWith('/notifications/channels') && method === 'GET') {
      if (state.linkIssued) {
        state.telegramStatusChecks += 1;
        if (state.telegramStatusChecks > 0) state.connected = true;
      }
      await route.fulfill({
        json: {
          data: {
            emailAvailable: true,
            telegram: {
              available: true,
              connected: state.connected,
              linkedAt: state.connected ? '2026-10-11T12:00:00.000Z' : null,
              botUsername: 'openqareer_bot',
            },
            mandatory: {
              security: {
                app: true,
                email: true,
                telegram: false,
                locked: true,
                sourceAvailable: false,
              },
              payments: {
                app: true,
                email: true,
                telegram: false,
                locked: true,
                sourceAvailable: false,
              },
            },
          },
        },
      });
      return true;
    }
    if (path.endsWith('/notifications/telegram/link') && method === 'POST') {
      state.linkIssued = true;
      await route.fulfill({
        json: {
          data: {
            startUrl: 'https://t.me/openqareer_bot?start=mock-code',
            expiresAt: '2026-10-11T12:10:00.000Z',
          },
        },
      });
      return true;
    }
    if (path.endsWith('/notifications/telegram/connection') && method === 'DELETE') {
      state.connected = false;
      await route.fulfill({ json: { data: { connected: false, disconnected: true } } });
      return true;
    }
    return false;
  };
  return { handler, preferences, state };
}

async function openNotifications(page: import('@playwright/test').Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Открыть аккаунт' }).click();
  const account = page.getByRole('dialog', { name: 'Аккаунт' });
  await account
    .getByRole('navigation', { name: 'Настройки аккаунта' })
    .getByRole('button', { name: 'Уведомления' })
    .click();
  await expect(account.getByRole('heading', { name: 'Уведомления' })).toBeVisible();
  return account;
}

async function writeKitAuditHtml(
  page: import('@playwright/test').Page,
  account: import('@playwright/test').Locator,
) {
  const [markup, styles] = await Promise.all([
    account.evaluate((element) => element.outerHTML),
    page.evaluate(() =>
      Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules, (rule) => rule.cssText);
          } catch {
            return [];
          }
        })
        .join('\n'),
    ),
  ]);
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${styles.replace(/<\/style/giu, '<\\/style')}</style></head><body>${markup}</body></html>`;
  writeFileSync(`${EVIDENCE_DIR}/account-notification-settings.html`, html);
}

test('desktop saves channel preferences, connects Telegram and keeps required messages locked', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop 1440 only');
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = createPreferencesHandler();
  await mockSignedInCabinet(page, { accountNotificationHandler: api.handler });
  const account = await openNotifications(page);
  await writeKitAuditHtml(page, account);

  const email = account.getByRole('checkbox', { name: 'Ответ работодателя, почта' });
  await expect(email).toBeChecked();
  await email.uncheck();
  await expect.poll(() => api.preferences[0]!.email).toBe(false);
  await expect(account.getByRole('checkbox', { name: /Платежи: .*почта/u })).toBeChecked();
  await expect(account.getByRole('checkbox', { name: /Платежи: .*почта/u })).toBeDisabled();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/notification-preferences-desktop-1440.png`,
    fullPage: true,
  });

  const desktopTelegram = account.locator('.career-account-notifications-desktop');
  await desktopTelegram.getByRole('button', { name: 'Подключить Telegram' }).click();
  await expect(
    desktopTelegram.getByRole('link', { name: 'Открыть @openqareer_bot' }),
  ).toHaveAttribute('href', 'https://t.me/openqareer_bot?start=mock-code');
  await desktopTelegram.getByRole('button', { name: 'Проверить подключение' }).click();
  await expect(desktopTelegram.getByRole('button', { name: 'Отключить' })).toBeVisible();
  const telegram = account.getByRole('checkbox', { name: 'Ответ работодателя, Telegram' });
  await expect(telegram).toBeEnabled();
  await telegram.uncheck();
  await expect.poll(() => api.preferences[0]!.telegram).toBe(false);
  await expect.poll(() => api.state.writes).toBe(2);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/notification-telegram-connected-desktop-1440.png`,
    fullPage: true,
  });
  await account.getByRole('checkbox', { name: /Платежи: .*почта/u }).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/notification-mandatory-desktop-1440.png`,
    fullPage: true,
  });
});

test('mobile shows event push details and persists channel changes without horizontal overflow', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Mobile 390 only');
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const api = createPreferencesHandler();
  await mockSignedInCabinet(page, { accountNotificationHandler: api.handler });
  const account = await openNotifications(page);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/notification-preferences-mobile-390.png`,
    fullPage: true,
  });

  await account.getByRole('button', { name: /Ответ работодателя/u }).click();
  const email = account.getByRole('checkbox', { name: 'Ответ работодателя, Почта' });
  await expect(email).toBeChecked();
  await email.uncheck();
  await expect.poll(() => api.preferences[0]!.email).toBe(false);
  await page.screenshot({
    path: `${EVIDENCE_DIR}/notification-event-mobile-390.png`,
    fullPage: true,
  });
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNotifications = account.locator('.career-account-notifications-mobile');
  await account.getByRole('button', { name: 'Назад' }).click();
  await mobileNotifications.getByRole('button', { name: 'Подключить Telegram' }).click();
  await expect(
    mobileNotifications.getByRole('link', { name: 'Открыть @openqareer_bot' }),
  ).toBeVisible();
  await mobileNotifications.getByRole('button', { name: 'Проверить подключение' }).click();
  await expect(mobileNotifications.getByRole('button', { name: 'Отключить' })).toBeVisible();
  await page.screenshot({
    path: `${EVIDENCE_DIR}/notification-telegram-connected-mobile-390.png`,
    fullPage: true,
  });
});
