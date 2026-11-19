import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const PROFILE = '/app/profile/linkedin';
const POSTS = '/app/profile/linkedin/posts';
const PUBLISHED = '/app/profile/linkedin/published';
const FEED = '/app/profile/linkedin/feed';

const linkedin = (connected: boolean) =>
  connected
    ? {
        platform: 'linkedin',
        available: true,
        capabilities: ['profile_read'],
        importsCareerHistory: true,
        status: 'imported',
        importedAt: '2026-11-03T09:40:00.000Z',
      }
    : {
        platform: 'linkedin',
        available: true,
        capabilities: [],
        importsCareerHistory: true,
        status: 'disconnected',
      };

const asr = (value: string) => ({ value, memoryId: 'm', sourceMessageIds: [], reviewFlags: [] });

const studio = {
  draft: null,
  savedAt: null,
  evidenceFreshness: { fresh: true },
  projection: {
    master: {
      kind: 'master',
      targetRole: 'Engineering Manager · платёжная платформа',
      about:
        'Руковожу разработкой платёжной платформы «Финтех Лаб»: 9 человек, релиз раз в 3 дня вместо 2 недель, перевод на Kubernetes без остановки сервиса. Ищу роль руководителя разработки в финтехе.',
      skills: [
        'Go',
        'Kubernetes',
        'PostgreSQL',
        'Управление командой',
        'Найм разработчиков',
        'Платёжные системы',
      ].map((name) => ({ id: name, name })),
      experience: [
        {
          id: 'e1',
          employer: asr('Финтех Лаб'),
          title: asr('Руководитель группы разработки'),
          description: asr('Группа из 9 человек, 6 из них наняла сама.'),
          bullets: [asr('Релиз раз в 3 дня вместо 2 недель.')],
        },
      ],
      education: [],
      languages: [],
      unknowns: [],
    },
    germanyVariant: {},
    evidenceSnapshot: [],
    excludedEvidenceIds: [],
  },
};

const draft = (index: number, kind: 'post' | 'comment', status: string) => ({
  id: `d${index}`,
  kind,
  status,
  topic: `Тема ${index}`,
  text: `Текст черновика ${index}`,
  ...(status === 'published' ? { publishedAt: '2026-11-04T10:00:00.000Z' } : {}),
});

async function mock(
  page: Page,
  options: {
    connected?: boolean;
    drafts?: unknown[];
    feed?: unknown[];
    queue?: unknown[];
    failFirst?: boolean;
  } = {},
): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'])
    .catch(() => undefined);
  await page.route('**/api/v1/candidate/connections', (route) =>
    route.fulfill({ json: { data: [linkedin(options.connected ?? true)] } }),
  );
  await page.route('**/api/v1/candidate/resume', (route) =>
    route.fulfill({ json: { data: studio } }),
  );
  const page20 = (items: unknown[]) => ({ items, total: items.length, offset: 0, limit: 20 });
  await page.route('**/api/v1/candidate/b640/linkedin/rhythm', (route) =>
    route.fulfill({
      json: { data: { postsPerWeek: 1, days: ['fri'], time: '10:00', timezone: 'Europe/Moscow' } },
    }),
  );
  await page.route('**/api/v1/candidate/b640/linkedin/queue?*', (route) =>
    route.fulfill({ json: { data: page20(options.queue ?? []) } }),
  );
  await page.route('**/api/v1/candidate/b640/linkedin/feed-posts?*', (route) =>
    route.fulfill({ json: { data: page20(options.feed ?? []) } }),
  );
  let failed = !options.failFirst;
  await page.route('**/api/v1/candidate/drafts?*', (route) => {
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'x' } } });
    }
    return route.fulfill({ json: { data: options.drafts ?? [] } });
  });
}

const feedPost = (index: number) => ({
  draftId: `f${index}`,
  postUrl: null,
  postExcerpt: `Пост ${index}`,
  comment: `Комментарий ${index}`,
  state: 'draft',
  createdAt: '2026-11-18T10:00:00.000Z',
  scheduledAt: null,
});

const publications = [
  draft(1, 'post', 'draft'),
  ...Array.from({ length: 24 }, (_, i) => draft(i + 2, i % 2 ? 'comment' : 'post', 'published')),
];

test.describe('B664: LinkedIn нового кабинета', () => {
  test('профиль: тексты и «Скопировать», без «Применить»', async ({ page }) => {
    await mock(page);
    await page.goto(PROFILE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="a03"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.li-sec-t')).toHaveText(['Заголовок', 'О себе', 'Опыт', 'Навыки']);
    await expect(page.getByRole('button', { name: /Применить/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Скопировать: Заголовок' }).click();
    await expect(page.getByText('Скопировано')).toBeVisible();
    await expectGates(page);
  });

  test('LinkedIn не подключён: строка с «Подключить»', async ({ page }) => {
    await mock(page, { connected: false });
    await page.goto(PROFILE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.src-title')).toContainText('LinkedIn', { timeout: 15_000 });
    await page.getByRole('link', { name: 'Подключить LinkedIn' }).click();
    await expect(page).toHaveURL(/\/app\/account\/connections/);
  });

  test('публикации: по 20 и «Показать ещё»', async ({ page }) => {
    await mock(page, { drafts: publications });
    await page.goto(PUBLISHED, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('li.li-pub')).toHaveCount(20, { timeout: 15_000 });
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    await expect(page.locator('li.li-pub')).toHaveCount(25);
    await expectGates(page);
  });

  test('посты: черновик с «Скопировать», без публикации', async ({ page }) => {
    await mock(page, { drafts: publications });
    await page.goto(POSTS, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#po-text')).toHaveValue('Текст черновика 1', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Одобрить и поставить в план' })).toBeVisible();
    await expect(page.getByText('не больше 1 поста в неделю')).toBeVisible();
    await expectGates(page);
  });

  test('посты: ошибка с «Повторить» на месте', async ({ page }) => {
    await mock(page, { drafts: publications, failFirst: true });
    await page.goto(POSTS, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить посты', {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('#po-text')).toBeVisible();
  });

  test('лента: пустое состояние «Новых постов нет»', async ({ page }) => {
    await mock(page);
    await page.goto(FEED, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.vl-empty-t')).toHaveText('Новых постов нет', { timeout: 15_000 });
    await expectGates(page);
  });

  test('лента: черновик комментария с «Скопировать»', async ({ page }) => {
    await mock(page, { feed: [feedPost(1)] });
    await page.goto(FEED, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.lk-card')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Одобрить', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Скопировать/ })).toBeVisible();
  });

  test('снимки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    test.setTimeout(150_000);
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    for (const [name, path, node, connected, drafts] of [
      ['linkedin', PROFILE, 'a03', true, publications],
      ['linkedin-off', PROFILE, 'a03', false, []],
      ['posts', POSTS, 'a03b', true, publications],
      ['published', PUBLISHED, 'a03p', true, publications],
      ['feed-empty', FEED, 'a05', true, []],
      ['feed', FEED, 'a05', true, []],
    ] as const) {
      await mock(page, {
        connected,
        drafts: [...drafts],
        feed: name === 'feed' ? [feedPost(1), feedPost(2)] : [],
      });
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
