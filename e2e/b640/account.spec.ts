import { mkdirSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;

const HH = {
  platform: 'hh',
  available: true,
  capabilities: ['resume_read'],
  importsCareerHistory: true,
  status: 'connected',
  accessMode: 'native_session_snapshot',
  connectedAt: '2026-11-10T09:00:00.000Z',
  lastImportedAt: '2026-11-03T06:12:00.000Z',
  factCount: 12,
} as const;
const LINKEDIN = {
  platform: 'linkedin',
  available: true,
  capabilities: ['profile_read'],
  importsCareerHistory: true,
  status: 'disconnected',
} as const;

const EVENTS = [
  'ev-reply',
  'ev-reminder',
  'ev-approval',
  'ev-delivery-error',
  'ev-target-company',
  'ev-weekly-digest',
].map((key) => ({ key, app: key !== 'ev-weekly-digest', email: true, telegram: false }));

interface AccountMocks {
  readonly telegram?: 'off' | 'on';
}

interface Calls {
  preferenceWrites: number;
  linkRequests: number;
  disconnected: string[];
  passwordChanges: number;
}

async function openAccount(page: Page, path: string, mocks: AccountMocks = {}): Promise<Calls> {
  const calls: Calls = {
    preferenceWrites: 0,
    linkRequests: 0,
    disconnected: [],
    passwordChanges: 0,
  };
  const state = { telegram: mocks.telegram === 'on', linkIssued: false, hh: true };
  const preferences = EVENTS.map((item) => ({ ...item }));
  const notifications = async (route: Route, pathname: string): Promise<boolean> => {
    const method = route.request().method();
    if (pathname.endsWith('/notifications/preferences') && method === 'GET') {
      await route.fulfill({ json: { data: { events: preferences } } });
      return true;
    }
    const key = pathname.match(/\/notifications\/preferences\/([^/]+)$/u)?.[1];
    if (key && method === 'PUT') {
      calls.preferenceWrites += 1;
      const saved = { key, ...(route.request().postDataJSON() as object) };
      await route.fulfill({ json: { data: saved } });
      return true;
    }
    if (pathname.endsWith('/notifications/channels')) {
      // После выдачи ссылки бот «подтверждает» при следующем чтении канала.
      if (state.linkIssued) state.telegram = true;
      const telegram = {
        available: true,
        connected: state.telegram,
        linkedAt: null,
        botUsername: 'openqareer_bot',
      };
      await route.fulfill({ json: { data: { emailAvailable: true, telegram, mandatory: {} } } });
      return true;
    }
    if (pathname.endsWith('/telegram/state')) {
      // B690: бот «подтверждает» при следующем чтении состояния, имя приходит с ним.
      if (state.linkIssued) state.telegram = true;
      const data = state.telegram
        ? { state: 'connected', expiresAt: null, username: '@msokolova_dev' }
        : { state: 'none', expiresAt: null, username: null };
      await route.fulfill({ json: { data } });
      return true;
    }
    if (pathname.endsWith('/telegram/link')) {
      calls.linkRequests += 1;
      state.linkIssued = true;
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      await route.fulfill({
        json: { data: { startUrl: 'https://t.me/openqareer_bot?start=mock-code', expiresAt } },
      });
      return true;
    }
    if (pathname.endsWith('/telegram/connection')) {
      state.telegram = false;
      state.linkIssued = false;
      await route.fulfill({ json: { data: { connected: false, disconnected: true } } });
      return true;
    }
    return false;
  };
  await mockSignedInCabinet(page, {
    cabinetB640: true,
    accountNotificationHandler: notifications,
    billing: { initialPlan: 'pro' },
  });
  await page.route('**/api/v1/candidate/connections**', (route) => {
    const platform = new URL(route.request().url()).pathname.split('/connections/')[1];
    if (route.request().method() === 'DELETE' && platform) {
      calls.disconnected.push(platform);
      state.hh = false;
      return route.fulfill({ json: { data: { platform, connectionRemoved: true } } });
    }
    const hh = state.hh ? HH : { ...LINKEDIN, platform: 'hh' };
    return route.fulfill({ json: { data: [hh, LINKEDIN] } });
  });
  await page.route('**/api/v1/account/password', (route) => {
    calls.passwordChanges += 1;
    return route.fulfill({
      json: {
        data: { username: 'flagged.test', email: null, displayName: null, role: 'candidate' },
      },
    });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.b640 .page.set-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.b640 .page.set-page')).not.toHaveAttribute('aria-busy', 'true');
  return calls;
}

test.describe('B661: «Аккаунт» нового кабинета, часть 1', () => {
  test('n00: разделы аккаунта ведут в свои экраны', async ({ page }) => {
    await openAccount(page, '/app/account');
    const screen = page.locator('[data-b640-node="n00"]');
    const links = screen.locator('.set-list a.set-t.set-a');
    await expect(links).toHaveText([
      'Вход и безопасность',
      'Подключения',
      'Уведомления',
      'Согласия и данные',
      'Приложение',
      'Подписка и платежи',
    ]);
    await expect(screen.locator('.set-row .set-v').nth(1)).toHaveText('hh.ru подключён');
    await expect(screen.locator('.set-row .set-v').last()).toHaveText('Pro');
    await expectGates(page);
    await links.nth(1).click();
    await expect(page).toHaveURL(/\/app\/account\/connections$/u);
    await expect(page.locator('[data-b640-node="n03"]')).toBeVisible();
  });

  test('n03: подключения и отключение площадки на месте', async ({ page }) => {
    const calls = await openAccount(page, '/app/account/connections');
    const screen = page.locator('[data-b640-node="n03"]');
    await expect(screen.locator('.set-h')).toHaveText('Подключено 2 из 4');
    await expect(screen.locator('.cn-row .set-t')).toHaveText([
      'Почта',
      'hh.ru',
      'LinkedIn',
      'Telegram',
    ]);
    await expectGates(page);
    await screen.getByRole('button', { name: 'Отключить hh.ru' }).click();
    const confirm = screen.getByRole('dialog', { name: 'Отключить hh.ru?' });
    await expect(confirm).toBeVisible();
    await expectGates(page);
    await confirm.getByRole('button', { name: 'Отключить' }).click();
    await expect(screen.locator('.set-h')).toHaveText('Подключено 1 из 4');
    await expect(confirm).toHaveCount(0);
    expect(calls.disconnected).toEqual(['hh']);
    await screen.getByRole('link', { name: 'Подключить Telegram' }).click();
    await expect(page).toHaveURL(/\/app\/account\/notifications$/u);
  });

  test('n02: переключатель сохраняется, Telegram привязывается на месте', async ({ page }) => {
    const calls = await openAccount(page, '/app/account/notifications');
    const screen = page.locator('[data-b640-node="n02"]');
    await expect(screen.locator('.set-mx.is-head .set-ch')).toHaveText([
      'Приложение',
      'Почта',
      'Telegram',
    ]);
    await expect(screen.locator('.set-mx:not(.is-head)')).toHaveCount(6);
    await expectGates(page);
    const digest = screen.getByRole('switch', { name: 'Итоги недели: Приложение' });
    await expect(digest).not.toBeChecked();
    await digest.check();
    await expect.poll(() => calls.preferenceWrites).toBe(1);
    await expect(digest).toBeChecked();

    await screen.getByRole('switch', { name: /Ответы: Telegram — подключить/u }).click();
    const waiting = screen.locator('p.set-res', { hasText: 'Ждём подтверждения в Telegram' });
    await expect(waiting).toBeVisible();
    await expect(waiting.getByRole('link', { name: 'Открыть бота' })).toHaveAttribute(
      'href',
      'https://t.me/openqareer_bot?start=mock-code',
    );
    await expectGates(page);
    const linked = screen.locator('p.set-res', { hasText: 'Telegram · @msokolova_dev' });
    await expect(linked).toBeVisible({ timeout: 10_000 });
    await expect(screen.getByRole('switch', { name: 'Ответы: Telegram' })).toBeVisible();
    await linked.getByRole('button', { name: 'Отвязать' }).click();
    await expect(
      screen.getByRole('switch', { name: /Ответы: Telegram — подключить/u }),
    ).toBeVisible();
    expect(calls.linkRequests).toBe(1);
    await expect(screen).not.toContainText(/пока недоступно|Как часто/iu);
  });

  test('n04: смена пароля на месте, устройства, выход', async ({ page }) => {
    const calls = await openAccount(page, '/app/account/security');
    const screen = page.locator('[data-b640-node="n04"]');
    await expect(screen.locator('.set-h')).toHaveText([
      'Почта и имя',
      'Вход',
      /^Устройства · \d+$/u,
    ]);
    await expect(screen).not.toContainText(/Двухфакторная|Touch ID/u);
    await expectGates(page);
    await screen.getByRole('button', { name: 'Сменить пароль' }).click();
    const form = screen.locator('form.c5-form');
    await form.getByLabel('Текущий пароль').fill('test-current-1');
    await form.getByLabel('Новый пароль', { exact: true }).fill('test-next-12345');
    await form.getByLabel('Повторите новый пароль').fill('test-next-1234');
    await expect(form.locator('.set-res.is-err')).toHaveText('Пароли не совпадают');
    await expect(form.getByRole('button', { name: 'Сохранить пароль' })).toBeDisabled();
    await expectGates(page);
    await form.getByLabel('Повторите новый пароль').fill('test-next-12345');
    await form.getByRole('button', { name: 'Сохранить пароль' }).click();
    await expect(screen.locator('.res-row')).toHaveText('Пароль изменён');
    await expect(form).toHaveCount(0);
    expect(calls.passwordChanges).toBe(1);
    await expect(screen.getByRole('button', { name: 'Выйти из аккаунта' })).toBeVisible();
  });

  test('вкладки аккаунта: текущая отмечена, на 390 «Назад» ведёт к разделам', async ({
    page,
  }, testInfo) => {
    await openAccount(page, '/app/account/security');
    if (testInfo.project.name === 'mobile-390') {
      await page.locator('.b640 .mob-back').click();
      await expect(page).toHaveURL(/\/app\/account$/u);
      return;
    }
    const tabs = page.locator('.b640 nav.acct-tabs a');
    await expect(tabs.filter({ hasText: 'Вход и безопасность' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await tabs.filter({ hasText: 'Подключения' }).click();
    await expect(page.locator('[data-b640-node="n03"]')).toBeVisible();
  });

  test('снимки «Аккаунта»: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(240_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      ['n00', '/app/account'],
      ['n03', '/app/account/connections'],
      ['n02', '/app/account/notifications'],
      ['n04', '/app/account/security'],
    ] as const;
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(
        (value) => window.localStorage.setItem('oq_b640_theme', value),
        theme,
      );
      for (const [name, path] of views) {
        for (const [width, height] of [
          [1440, 900],
          [1176, 900],
          [390, 844],
        ]) {
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await page.setViewportSize({ width, height });
          await openAccount(page, path);
          await page.screenshot({ path: `.s13-shots/${name}-${width}-${theme}.png` });
        }
      }
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openAccount(page, '/app/account/security');
      await page.getByRole('button', { name: 'Сменить пароль' }).click();
      await page.screenshot({ path: `.s13-shots/n04b-1440-${theme}.png` });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await openAccount(page, '/app/account/connections');
      await page.getByRole('button', { name: 'Отключить hh.ru' }).click();
      await page.screenshot({ path: `.s13-shots/n03f-1440-${theme}.png` });
    }
  });
});
