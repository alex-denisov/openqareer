import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;

type Plan = 'free' | 'basic' | 'pro' | 'max';

interface Calls {
  planRequests: number;
  checkouts: number;
  deletions: number;
  restores: number;
}

const DELETION = {
  requestedAt: '2026-11-19T10:00:00.000Z',
  purgeAfter: '2026-12-19T10:00:00.000Z',
};

async function openAccount(page: Page, path: string, plan: Plan = 'free'): Promise<Calls> {
  const calls: Calls = { planRequests: 0, checkouts: 0, deletions: 0, restores: 0 };
  await mockSignedInCabinet(page, { cabinetB640: true, billing: { initialPlan: plan } });
  let deletion: typeof DELETION | null = null;
  await page.route('**/api/v1/candidate/account/deletion', (route) => {
    const method = route.request().method();
    if (method === 'POST') {
      calls.deletions += 1;
      deletion = DELETION;
    }
    if (method === 'DELETE') {
      calls.restores += 1;
      deletion = null;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { data: deletion } });
  });
  await page.route('**/api/v1/candidate/plan-requests', (route) => {
    if (route.request().method() === 'POST') {
      calls.planRequests += 1;
      return route.fulfill({
        status: 201,
        json: { data: { planId: 'consultant', createdAt: '2026-11-17T10:00:00.000Z' } },
      });
    }
    const sent = calls.planRequests > 0;
    const data = sent ? [{ planId: 'consultant', createdAt: '2026-11-17T10:00:00.000Z' }] : [];
    return route.fulfill({ json: { data } });
  });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/billing/checkouts'))
      calls.checkouts += 1;
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const screen = page.locator('.b640 .page[data-b640-section="account"]');
  await expect(screen).toBeVisible({ timeout: 15_000 });
  await expect(screen).not.toHaveAttribute('aria-busy', 'true');
  return calls;
}

test.describe('B661: «Аккаунт» и «Тарифы» нового кабинета, часть 2', () => {
  test('n05: согласия, «Остановить всё» с подтверждением, выгрузка, удаление аккаунта', async ({
    page,
  }) => {
    await openAccount(page, '/app/account/data');
    const screen = page.locator('[data-b640-node="n05"]');
    await expect(screen.locator('.set-h').first()).toHaveText('На что вы дали согласие');
    await expect(screen.locator('.set-h').last()).toHaveText('Удаление аккаунта');
    await expect(screen.getByRole('switch')).toHaveCount(3);
    await expect(screen.getByRole('button', { name: 'Удалить аккаунт' })).toHaveText('Удалить');
    await expect(screen).not.toContainText(/пока недоступно/iu);
    await expectGates(page);
    const download = page.waitForEvent('download');
    await screen.getByRole('button', { name: 'Скачать мои данные' }).click();
    expect((await download).suggestedFilename()).toBe('openqareer-candidate-export.json');
    await expect(screen.locator('.res-row')).toHaveText('Файл сохранён');
  });

  test('n05b: удаление с отсрочкой после окна и возврат аккаунта', async ({ page }) => {
    const calls = await openAccount(page, '/app/account/data');
    const screen = page.locator('[data-b640-node="n05"]');
    await screen.getByRole('button', { name: 'Удалить аккаунт' }).click();
    const dialog = page.getByRole('dialog', { name: 'Удалить аккаунт?' });
    await expect(dialog.locator('.c5-list li')).toHaveCount(3);
    await expectGates(page);
    await dialog.getByRole('button', { name: 'Оставить' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls.deletions).toBe(0);
    await screen.getByRole('button', { name: 'Удалить аккаунт' }).click();
    await dialog.getByRole('button', { name: 'Удалить аккаунт' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(screen.locator('.set-row').last().locator('.set-t')).toHaveText(
      'Аккаунт удалится 19 декабря',
    );
    expect(calls.deletions).toBe(1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await screen.getByRole('button', { name: 'Вернуть аккаунт' }).click();
    await expect(screen.getByRole('button', { name: 'Удалить аккаунт' })).toBeVisible();
    expect(calls.restores).toBe(1);
  });

  test('n05: текст согласия показан до выдачи', async ({ page }) => {
    await openAccount(page, '/app/account/data');
    await page.getByRole('switch', { name: 'Цифровой след' }).click();
    const dialog = page.getByRole('dialog', { name: 'Аудит открытого профессионального следа' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.c5-list li').first()).toBeVisible();
    await expectGates(page);
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Цифровой след' })).not.toBeChecked();
  });

  test('n05: отзыв «Цифрового следа» спрашивает подтверждение', async ({ page }) => {
    await mockSignedInCabinet(page, { cabinetB640: true });
    let revokes = 0;
    await page.route('**/api/v1/me/consents**', (route) => {
      if (route.request().method() === 'DELETE') {
        revokes += 1;
        return route.fulfill({ json: { data: { granted: false, revoked: true, consent: null } } });
      }
      const consent = {
        id: 'c1',
        capability: 'digital_footprint',
        versionId: 'digital_footprint-v1.2',
        grantedAt: '2026-11-01T10:00:00.000Z',
        revokedAt: revokes > 0 ? '2026-11-18T10:00:00.000Z' : null,
      };
      return route.fulfill({ json: { data: { consents: [consent] } } });
    });
    await page.goto('/app/account/data', { waitUntil: 'domcontentloaded' });
    const toggle = page.getByRole('switch', { name: 'Цифровой след' });
    await expect(toggle).toBeChecked({ timeout: 15_000 });
    await toggle.click();
    const dialog = page.getByRole('dialog', { name: 'Отозвать согласие на цифровой след?' });
    await expect(dialog).toContainText('Сохранённые находки удалятся.');
    await expectGates(page);
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(toggle).toBeChecked();
    expect(revokes).toBe(0);
    await toggle.click();
    await dialog.getByRole('button', { name: 'Отозвать' }).click();
    await expect(toggle).not.toBeChecked();
    expect(revokes).toBe(1);
  });

  test('n06: тема переключается сразу, часовой пояс выбирается, валюта сохраняется', async ({
    page,
  }, testInfo) => {
    const saved: unknown[] = [];
    await openAccount(page, '/app/account/app');
    await page.route('**/api/v1/candidate/b640/app-preferences', async (route) => {
      if (route.request().method() === 'PUT') saved.push(route.request().postDataJSON());
      const data = { theme: null, moneyCurrency: saved.length > 2 ? 'USD' : null };
      await route.fulfill({ json: { data } });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const screen = page.locator('[data-b640-node="n06"]');
    await expect(screen.locator('.set-group').first().locator('.set-row .set-t')).toHaveText([
      'Тема',
      'Язык',
      'Часовой пояс',
      'Валюта зарплат',
    ]);
    await expectGates(page);
    await screen.getByRole('radio', { name: 'Тёмная' }).check();
    await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', 'dark');
    await screen.getByRole('radio', { name: 'Светлая' }).check();
    await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', 'light');
    await expect(screen.getByRole('combobox', { name: 'Язык' })).toHaveValue('ru');
    await expect(screen.getByRole('combobox', { name: 'Часовой пояс' })).toHaveValue(
      'Europe/Moscow',
    );
    await screen.getByRole('radio', { name: '$' }).check();
    await expect.poll(() => saved.at(-1)).toEqual({ moneyCurrency: 'USD' });
    expect(saved.slice(0, 2)).toEqual([{ theme: 'dark' }, { theme: 'light' }]);
    await expect(screen).not.toContainText(/строке меню|Запуск при входе|Обновлять автоматически/u);
    const download = screen.getByRole('link', { name: 'Скачать' });
    if (testInfo.project.name === 'mobile-390') {
      await expect(screen.locator('.set-h').filter({ visible: true })).toHaveText(['Интерфейс']);
      await expect(download).toBeHidden();
    } else {
      await expect(screen.locator('.set-h')).toHaveText(['Интерфейс', 'Обновления']);
      await expect(screen.locator('.set-row .set-t').nth(4)).toHaveText(/^Версия \d+\.\d+\.\d+/u);
      await expect(screen.locator('.set-row .set-t').nth(5)).toHaveText('Приложение для Mac');
      await expect(download).toHaveAttribute('href', '/downloads/openqareer-macos.dmg');
    }
  });

  test('t03: подписка, автопродление с подтверждением, заявка на консультанта', async ({
    page,
  }) => {
    const calls = await openAccount(page, '/app/account/billing', 'pro');
    const screen = page.locator('[data-b640-node="t03"]');
    await expect(screen.locator('.set-row .set-t').first()).toHaveText('Pro');
    await expectGates(page);
    await screen.getByRole('switch', { name: 'Автопродление' }).click();
    const dialog = page.getByRole('dialog', { name: 'Отключить автопродление?' });
    await expect(dialog).toBeVisible();
    await expectGates(page);
    await dialog.getByRole('button', { name: 'Отключить' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(screen.getByRole('switch', { name: 'Автопродление' })).not.toBeChecked();
    await screen.getByRole('button', { name: 'Оставить заявку' }).click();
    await expect(screen.locator('.req-done')).toHaveText('Заявка отправлена');
    expect(calls.planRequests).toBe(1);
  });

  test('t03 на Free: платежей нет и путь к тарифам', async ({ page }) => {
    await openAccount(page, '/app/account/billing', 'free');
    const screen = page.locator('[data-b640-node="t03"]');
    await expect(screen.locator('.set-row .set-t').first()).toHaveText('Free');
    await expect(screen).toContainText('Платежей нет');
    await expectGates(page);
    await screen.getByRole('link', { name: 'Выбрать тариф' }).click();
    await expect(page).toHaveURL(/\/app\/tariffs$/u);
  });

  test('t01 → оплата: счёт создаётся только по «Перейти к оплате», списания нет', async ({
    page,
  }, testInfo) => {
    const calls = await openAccount(page, '/app/tariffs', 'free');
    const screen = page.locator('[data-b640-node="t01"]');
    await expect(screen.locator('article.tier')).toHaveCount(4);
    await expect(screen.locator('article.tier.now h3')).toContainText('Free');
    await expect(screen).not.toContainText(/Executive|на сутки/iu);
    await expectGates(page);
    if (testInfo.project.name === 'mobile-390') {
      await expect(screen.locator('article.tier:visible')).toHaveCount(1);
    }
    await screen.locator('article.tier.next a.btn.is-primary').click();
    await expect(page).toHaveURL(/\/app\/account\/billing\?pay=basic$/u);
    const pay = page.locator('[data-b640-view="checkout"]');
    await expect(pay.locator('.lead-title')).toHaveText('Перейти к оплате Basic');
    await expect(pay.locator('dl.kv dd.num')).toContainText('3');
    await expectGates(page);
    expect(calls.checkouts).toBe(0);
    await pay.getByRole('button', { name: 'Перейти к оплате' }).click();
    const bank = pay.getByRole('link', { name: 'Открыть страницу оплаты' });
    await expect(bank).toHaveAttribute('href', /^https:\/\/auth\.robokassa\.ru\//u);
    await expect(bank).toHaveAttribute('target', '_blank');
    expect(calls.checkouts).toBe(1);
    // Страница остаётся в кабинете: к банку ведёт только явное нажатие на ссылку.
    await expect(page).toHaveURL(/\/app\/account\/billing\?pay=basic$/u);
    await expectGates(page);
    await pay.getByRole('link', { name: 'Остаться на Free' }).click();
    await expect(page).toHaveURL(/\/app\/tariffs$/u);
  });

  test('снимки второй части: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(240_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      ['n05', '/app/account/data', 'free'],
      ['n06', '/app/account/app', 'free'],
      ['t03', '/app/account/billing', 'pro'],
      ['t03f', '/app/account/billing', 'free'],
      ['t03b', '/app/account/billing?pay=basic', 'free'],
      ['t01', '/app/tariffs', 'free'],
    ] as const;
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(
        (value) => window.localStorage.setItem('oq_b640_theme', value),
        theme,
      );
      for (const [name, path, plan] of views) {
        for (const [width, height] of [
          [1440, 900],
          [1176, 900],
          [390, 844],
        ]) {
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await page.setViewportSize({ width, height });
          await openAccount(page, path, plan);
          await page.screenshot({ path: `.s13-shots/${name}-${width}-${theme}.png` });
        }
      }
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openAccount(page, '/app/account/data');
      await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
      await page.screenshot({ path: `.s13-shots/n05b-1440-${theme}.png` });
    }
  });
});
