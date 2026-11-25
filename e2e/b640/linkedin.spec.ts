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
  // B645 a03: без импорта LinkedIn — `no_import`; с импортом — семь разделов без предложений.
  const ids = ['headline', 'about', 'experience', 'education', 'courses', 'skills', 'languages'];
  const sections = ids.map((id) => ({ id, current: `${id}: сейчас`, offer: null }));
  await page.route('**/api/v1/candidate/b640/linkedin/profile', (route) =>
    route.fulfill({
      json: {
        data:
          options.connected === false
            ? { kind: 'no_import' }
            : { kind: 'ready', sections, rewriting: false },
      },
    }),
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
  test('профиль: семь разделов из импорта, без полей вставки и «Применить»', async ({ page }) => {
    await mock(page);
    await page.goto(PROFILE, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="a03"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.li-sec-t')).toHaveText([
      'Заголовок',
      'О себе',
      'Опыт',
      'Образование',
      'Курсы и сертификаты',
      'Навыки',
      'Языки',
    ]);
    await expect(page.getByRole('button', { name: /Применить/ })).toHaveCount(0);
    await expect(page.locator('textarea')).toHaveCount(0);
    await expectGates(page);
  });

  test('без импорта LinkedIn: строка с «Подключить»', async ({ page }) => {
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

  test('посты: черновик с «Другой вариант · 3», без публикации', async ({ page }) => {
    await mock(page, { drafts: publications });
    await page.route('**/api/v1/candidate/text-variants?*', (route) =>
      route.fulfill({ json: { data: { variants: [], remaining: 3 } } }),
    );
    await page.goto(POSTS, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#po-text')).toHaveValue('Текст черновика 1', { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Одобрить и поставить в план' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Другой вариант · 3' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Скопировать/ })).toHaveCount(0);
    await expect(page.getByText('не больше 1 поста в неделю')).toBeVisible();
    await expectGates(page);
  });

  test('посты: другой вариант с пожеланием встаёт в поле, листается «‹ 2 из 2 ›»', async ({
    page,
  }) => {
    await mock(page, { drafts: publications });
    await page.route('**/api/v1/candidate/text-variants?*', (route) =>
      route.fulfill({ json: { data: { variants: [], remaining: 3 } } }),
    );
    const variant = {
      id: 'v1',
      position: 1,
      text: 'Другой текст поста',
      wish: { chips: ['shorter'], text: '' },
      createdAt: '2026-11-23T10:00:00.000Z',
      payload: null,
    };
    let body: unknown = null;
    await page.route('**/api/v1/candidate/b640/linkedin/drafts/*/variants', (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { data: { variant, variants: [variant], remaining: 2 } },
      });
    });
    await page.goto(POSTS, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Другой вариант · 3' }).click({ timeout: 15_000 });
    const pop = page.getByRole('dialog', { name: 'Что поменять' });
    await pop.getByRole('button', { name: 'Короче' }).click();
    await pop.getByRole('button', { name: 'Сделать вариант' }).click();
    await expect(page.locator('#po-text')).toHaveValue('Другой текст поста');
    expect(body).toEqual({ wish: { chips: ['shorter'], text: '' } });
    await expect(page.getByRole('group', { name: 'Варианты поста' })).toContainText('2 из 2');
    await page.getByRole('button', { name: 'Предыдущий вариант' }).click();
    await expect(page.locator('#po-text')).toHaveValue('Текст черновика 1');
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

  test('лента: черновик комментария — «Одобрить», «Другой вариант · 3», «Пропустить»', async ({
    page,
  }) => {
    await mock(page, { feed: [feedPost(1)] });
    await page.route('**/api/v1/candidate/text-variants?*', (route) =>
      route.fulfill({ json: { data: { variants: [], remaining: 3 } } }),
    );
    let skipped: unknown = null;
    await page.route('**/api/v1/candidate/b640/linkedin/feed-posts/f1/skip', (route) => {
      skipped = route.request().method();
      return route.fulfill({ json: { data: { draftId: 'f1', skipped: true } } });
    });
    await page.goto(FEED, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.lk-card')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Одобрить', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Другой вариант · 3' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Скопировать/ })).toHaveCount(0);
    await expect(page.locator('textarea.lk-draft')).toBeEditable();
    await expectGates(page);
    await page.getByRole('button', { name: 'Пропустить' }).click();
    await expect.poll(() => skipped).toBe('POST');
  });

  test('лента a05b: без нового черновика главная — «Настроить ритм», на 390 лист', async ({
    page,
  }, testInfo) => {
    const at = '2026-12-01T10:00:00.000Z';
    await mock(page, {
      feed: [{ ...feedPost(1), state: 'queued', scheduledAt: at }],
      queue: [
        {
          id: 'q1',
          draftId: 'c1',
          kind: 'comment',
          text: 'В очереди',
          scheduledAt: at,
          state: 'queued',
          updatedAt: at,
          remindedAt: null,
          openUrl: null,
        },
      ],
    });
    const days = ['mon', 'tue', 'wed', 'thu', 'fri'];
    await page.route('**/api/v1/candidate/b640/linkedin/rhythm', (route) =>
      route.fulfill({
        json: {
          data: {
            postsPerWeek: 1,
            days: ['fri'],
            time: '10:00',
            timezone: 'Europe/Moscow',
            comments: { perDay: 2, days, from: '10:00', to: '18:00' },
          },
        },
      }),
    );
    await page.goto(FEED, { waitUntil: 'domcontentloaded' });
    const rhythm = page.getByRole('button', { name: 'Настроить ритм' });
    await expect(rhythm).toBeVisible({ timeout: 15_000 });
    await expect(rhythm).toHaveClass(/is-primary/);
    await expect(page.locator('main .is-primary')).toHaveCount(1);
    await expectGates(page);
    if (testInfo.project.name !== 'mobile-390') return;
    // Макет a05b (data-mtight): шаг колонки на 390 — 16, а не 24.
    const gap = await page
      .locator('.page.two > .col')
      .first()
      .evaluate((el) => getComputedStyle(el).rowGap);
    expect(gap).toBe('16px');
    // На 390 главная кнопка стоит в полосе над навигацией, всплывашка — лист снизу.
    const button = await rhythm.boundingBox();
    expect(button && button.y + button.height).toBeGreaterThan(700);
    await rhythm.click();
    const sheet = await page.locator('#va-pop-rh').boundingBox();
    expect(sheet?.x).toBe(0);
    expect(sheet?.width).toBe(390);
    expect(sheet && sheet.y + sheet.height).toBeCloseTo(844, 0);
    const chip = await page.locator('#va-pop-rh .va-pop-chips .chip').first().boundingBox();
    expect(chip?.height).toBeGreaterThanOrEqual(44);
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
