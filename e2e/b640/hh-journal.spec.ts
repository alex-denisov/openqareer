import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const HH_PATH = '/app/profile/hh';
const JOURNAL_PATH = '/app/profile/journal';
const TOTAL = 27;

const hh = (connected: boolean) =>
  connected
    ? {
        platform: 'hh',
        available: true,
        capabilities: ['resume_read'],
        importsCareerHistory: true,
        status: 'connected',
        accessMode: 'native_session_snapshot',
        connectedAt: '2026-11-01T09:00:00.000Z',
        lastImportedAt: '2026-11-03T09:40:00.000Z',
        factCount: 12,
      }
    : {
        platform: 'hh',
        available: true,
        capabilities: [],
        importsCareerHistory: true,
        status: 'disconnected',
      };

const entry = (index: number) => ({
  id: `j${index}`,
  queueItemId: `q${index}`,
  platform: index % 3 === 0 ? 'linkedin' : 'hh',
  result: index % 7 === 0 ? 'error' : index % 5 === 0 ? 'removed' : 'delivered',
  receiptStatus: 'delivered',
  attempted: true,
  localDate: '2026-11-10',
  company: ['Гринкод', 'Ладога Банк', 'Лента Финанс', 'Арка Холдинг'][index % 4]!,
  occurredAt: `2026-11-${String(18 - (index % 17)).padStart(2, '0')}T16:05:00.000Z`,
  receiptId: null,
  failureCode: null,
});

async function mockHh(page: Page, connected: boolean): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route('**/api/v1/candidate/connections', (route) =>
    route.fulfill({ json: { data: [hh(connected)] } }),
  );
  let enabled = true;
  await page.route('**/api/v1/candidate/b640/hh/raise', (route) => {
    if (route.request().method() === 'PUT')
      enabled = Boolean(route.request().postDataJSON()?.enabled);
    return route.fulfill({
      json: {
        data: {
          connected,
          resumeId: connected ? 'cv-1' : null,
          enabled,
          everyHours: 4,
          lastRaisedAt: '2026-11-19T06:40:00.000Z',
          nextRaiseAt: '2026-11-19T10:40:00.000Z',
          lastResult: { status: 'ok', reason: null, at: '2026-11-19T06:40:00.000Z' },
          pausedUntil: null,
          pauseReason: null,
        },
      },
    });
  });
  await page.route('**/api/v1/candidate/actions/usage', (route) =>
    route.fulfill({
      json: {
        data: {
          usage: { hhBoostsCount: 1, lastHhBoostAt: '2026-11-16T09:40:00.000Z' },
          timezone: 'Europe/Moscow',
          resetAt: '2026-11-17T00:00:00.000Z',
          killSwitchActive: false,
          limits: {},
        },
      },
    }),
  );
}

async function mockJournal(
  page: Page,
  options: { empty?: boolean; failFirst?: boolean } = {},
): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  let failed = !options.failFirst;
  await page.route('**/api/v1/candidate/automation/journal?*', (route) => {
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'x' } } });
    }
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    const all = options.empty ? [] : Array.from({ length: TOTAL }, (_, i) => entry(i));
    return route.fulfill({
      json: {
        data: {
          entries: all.slice(offset, offset + 20),
          periodDays: 30,
          counts: { total: all.length, delivered: 19, errors: 4, removed: 4 },
          limit: 20,
          offset,
        },
      },
    });
  });
}

test.describe('B664: hh.ru и журнал нового кабинета', () => {
  test('hh.ru подключён: «Автоподнятие резюме», данные, без аналитики', async ({ page }) => {
    await mockHh(page, true);
    await page.goto(HH_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="a11"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.hh-st dt')).toContainText([
      'Последнее поднятие',
      'Поднятий сегодня',
      'Данные из резюме обновлены',
    ]);
    const raise = page.getByRole('switch', { name: 'Автоподнятие резюме' });
    await expect(raise).toBeChecked();
    await expect(page.getByText(/^Резюме поднято · /u)).toBeVisible();
    await raise.click();
    await expect(raise).not.toBeChecked();
    await expectGates(page);
  });

  test('hh.ru не подключён: строка площадки с «Подключить»', async ({ page }) => {
    await mockHh(page, false);
    await page.goto(HH_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="a11"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.src-title')).toContainText('hh.ru');
    await page.getByRole('link', { name: 'Подключить hh.ru' }).click();
    await expect(page).toHaveURL(/\/app\/account\/connections/);
  });

  test('журнал: по 20, «Показать ещё», итоги периода', async ({ page }) => {
    await mockJournal(page);
    await page.goto(JOURNAL_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="a05c"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('li.row')).toHaveCount(20);
    await expect(page.locator('.kv dt')).toHaveText(['Отправлено', 'Ошибки', 'Убрано']);
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    await expect(page.locator('li.row')).toHaveCount(TOTAL);
    await expectGates(page);
  });

  test('журнал пуст: одна строка', async ({ page }) => {
    await mockJournal(page, { empty: true });
    await page.goto(JOURNAL_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vl-empty-t')).toHaveText('За 30 дней действий не было');
  });

  test('журнал: ошибка с «Повторить» на месте', async ({ page }) => {
    await mockJournal(page, { failFirst: true });
    await page.goto(JOURNAL_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить журнал');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('li.row')).toHaveCount(20);
  });

  test('снимки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    test.setTimeout(150_000);
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    for (const [name, path, node, connected] of [
      ['hh', HH_PATH, 'a11', true],
      ['hh-off', HH_PATH, 'a11', false],
      ['journal', JOURNAL_PATH, 'a05c', true],
    ] as const) {
      if (name === 'journal') await mockJournal(page);
      else await mockHh(page, connected);
      for (const theme of ['light', 'dark'] as const) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator(`[data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
        for (const width of desktop ? [1440, 1176] : [390]) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
});
