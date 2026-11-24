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

const KINDS = ['post_published', 'comment_published', 'removed'] as const;
const event = (index: number) =>
  index === 0
    ? {
        id: 'reply:pavel',
        kind: 'replied',
        at: '2026-11-18T13:05:00.000Z',
        text: null,
        url: null,
        contact: { id: 'pavel', name: 'Павел Ким' },
      }
    : {
        id: `queue:q${index}`,
        kind: KINDS[index % 3]!,
        at: `2026-11-${String(18 - (index % 17)).padStart(2, '0')}T07:00:00.000Z`,
        text: [
          'Платёжная очередь без потерь на пиках',
          'Платформенная команда: кто платит',
          'Как мы ушли от ночных релизов',
        ][index % 3]!,
        url: null,
        contact: null,
      };

async function mockHh(page: Page, connected: boolean): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route('**/api/v1/candidate/connections', (route) =>
    route.fulfill({ json: { data: [hh(connected)] } }),
  );
  let enabled = true;
  let resumeId = 'cv-1';
  await page.route('**/api/v1/candidate/b640/hh/raise', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      enabled = Boolean(body?.enabled);
      resumeId = body?.resumeId ?? resumeId;
    }
    return route.fulfill({
      json: {
        data: {
          connected,
          resumeId: connected ? resumeId : null,
          resumes: connected
            ? [
                {
                  id: 'cv-1',
                  title: 'Руководитель разработки',
                  updatedLabel: 'обновлено 3 ноября',
                },
                { id: 'cv-2', title: 'Ведущий разработчик Go', updatedLabel: 'обновлено в 2023' },
              ]
            : [],
          enabled,
          everyHours: 4,
          lastRaisedAt: '2026-11-19T06:40:00.000Z',
          nextRaiseAt: '2026-11-19T10:40:00.000Z',
          lastResult: { status: 'ok', reason: null, at: '2026-11-19T06:40:00.000Z' },
          pausedUntil: null,
          pauseReason: null,
          pending: false,
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
  await page.route('**/api/v1/candidate/b640/linkedin/journal?*', (route) => {
    if (!failed) {
      failed = true;
      return route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'x', retryable: false } },
      });
    }
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
    const all = options.empty ? [] : Array.from({ length: TOTAL }, (_, i) => event(i));
    return route.fulfill({
      json: {
        data: {
          events: all.slice(offset, offset + 20),
          total: all.length,
          offset,
          limit: 20,
          month: { month: '2026-11-01', posts: 1, comments: 4, replies: 2 },
        },
      },
    });
  });
}

test.describe('B664/B696: hh.ru и журнал LinkedIn нового кабинета', () => {
  test('hh.ru подключён: «Автоподнятие резюме» и выбор резюме, данные, без аналитики', async ({
    page,
  }) => {
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
    const resume = page.getByLabel('Резюме', { exact: true });
    await expect(resume).toHaveValue('cv-1');
    await resume.selectOption('Ведущий разработчик Go · обновлено в 2023');
    await expect(resume).toBeEnabled();
    await expect(resume).toHaveValue('cv-2');
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

  test('журнал LinkedIn: «Павел ответил», по 20, «Показать ещё», итоги месяца', async ({
    page,
  }) => {
    await mockJournal(page);
    await page.goto(JOURNAL_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="a05c"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.lead-title')).toHaveText('Павел ответил');
    await expect(page.getByRole('link', { name: 'Написать Павлу' })).toHaveAttribute(
      'href',
      /#write-pavel$/u,
    );
    await expect(page.locator('li.row')).toHaveCount(20);
    await expect(page.locator('#jn-sum')).toHaveText('За ноябрь');
    await expect(page.locator('.kv dt')).toHaveText(['Посты', 'Комментарии', 'Ответы']);
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    await expect(page.locator('li.row')).toHaveCount(TOTAL);
    await expectGates(page);
  });

  test('журнал пуст: одна строка', async ({ page }) => {
    await mockJournal(page, { empty: true });
    await page.goto(JOURNAL_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vl-empty-t')).toHaveText('Событий LinkedIn пока нет');
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
