import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const PROFILE = '/app/profile/linkedin';
const API = '**/api/v1/candidate/b640/linkedin/profile';

const offer = (key: string, text: string) => ({ key, variants: [text], doneAt: null });
const place = (id: string, label: string, current: string, text?: string) => ({
  id,
  label,
  current,
  offer: text ? offer(`experience:${id}`, text) : null,
});

/** Макет a03: семь разделов, «сейчас» из импорта LinkedIn, предложения у четырёх. */
const READY = {
  kind: 'ready',
  sections: [
    {
      id: 'headline',
      current: 'Руковожу группой разработки платёжной платформы · Go, Kotlin, Kubernetes',
      offer: offer(
        'headline',
        'Engineering Manager · платёжная платформа · Go, Kotlin, Kubernetes',
      ),
    },
    {
      id: 'about',
      current: 'Руковожу группой разработки платёжной платформы в «Финтех Лаб».',
      offer: offer(
        'about',
        'Руковожу разработкой платёжной платформы «Финтех Лаб»: 9 человек, релиз раз в 3 дня вместо 2 недель. Ищу роль руководителя разработки в финтехе.',
      ),
    },
    {
      id: 'experience',
      current: null,
      offer: null,
      places: [
        place(
          'e1',
          'Финтех Лаб · Руководитель группы разработки',
          'Руковожу группой разработки платёжной платформы.',
          'Группа из 9 человек, 6 из них наняла сама. Релиз раз в 3 дня вместо 2 недель.',
        ),
        place('e2', 'Сфера Платежи · Руководитель группы бэкенда', 'Вела бэкенд платёжного шлюза.'),
        place(
          'e3',
          'Альфа · Разработчик',
          'Писала сервисы на Go.',
          'Писала платёжные сервисы на Go.',
        ),
      ],
    },
    {
      id: 'education',
      current: 'МГТУ им. Баумана · Информатика и системы управления · 2009 — 2014',
      offer: null,
    },
    { id: 'courses', current: 'Certified Kubernetes Administrator · 2023 · ещё 3', offer: null },
    {
      id: 'skills',
      current: 'Go · Kotlin · PostgreSQL · Kubernetes · Управление командой',
      offer: offer(
        'skills',
        'Go · Kubernetes · PostgreSQL · Управление командой · Найм разработчиков',
      ),
    },
    { id: 'languages', current: 'Русский — родной · Английский — B2 · Немецкий — A2', offer: null },
  ],
};

interface MockOptions {
  readonly view?: unknown;
  readonly failRead?: boolean;
}

async function mock(page: Page, options: MockOptions = {}) {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'])
    .catch(() => undefined);
  await page.route(API, (route) =>
    options.failRead
      ? route.fulfill({ status: 500, json: { error: { code: 'internal', message: 'x' } } })
      : route.fulfill({ json: { data: options.view ?? READY } }),
  );
  await page.route(`${API}/done`, (route) => {
    const { keys } = route.request().postDataJSON() as { keys: string[] };
    return route.fulfill({
      json: {
        data: { done: Object.fromEntries(keys.map((key) => [key, '2026-11-19T12:30:00.000Z'])) },
      },
    });
  });
  await page.route(`${API}/offers/*/variant`, (route) =>
    route.fulfill({
      json: {
        data: {
          key: 'headline',
          variants: [
            'Engineering Manager · платёжная платформа · Go, Kotlin, Kubernetes',
            'Руководитель разработки · финтех · Go, Kubernetes',
          ],
          doneAt: null,
        },
      },
    }),
  );
}

const open = async (page: Page) => {
  await page.goto(PROFILE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="a03"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.li-sec')).toHaveCount(7);
};
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Кнопка видна целиком и не закрыта закреплённой панелью или навигацией. */
async function expectNotCovered(page: Page, selector: string) {
  const free = await page
    .locator(selector)
    .first()
    .evaluate((node) => {
      node.scrollIntoView({ block: 'center' });
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && node.contains(hit));
    });
  expect(free).toBe(true);
}

test.describe('B645 a03: профиль LinkedIn по макету', () => {
  test('семь разделов из импорта, без полей вставки и строки фактов', async ({ page }) => {
    await mock(page);
    await open(page);
    await expect(page.locator('.li-sec-t')).toHaveText([
      'Заголовок',
      'О себе',
      'Опыт',
      'Образование',
      'Курсы и сертификаты',
      'Навыки',
      'Языки',
    ]);
    await expect(page.locator('#li-title')).toHaveText('Изменить 4 раздела из 7');
    await expect(page.locator('textarea, .li-facts, .li-facts-d')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Применить|Сохранить|Вставлено/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: 'Другой вариант: Заголовок · осталось 2' }),
    ).toBeVisible();
    const experience = page.locator('.li-sec').nth(2);
    await expect(experience.locator(':scope > .li-rec .li-rec-l')).toHaveText([
      'Финтех Лаб · Руководитель группы разработки',
      'Сфера Платежи · Руководитель группы бэкенда',
    ]);
    await expect(experience.locator('details.more-n > summary')).toHaveText(
      'Ещё 1 место работы · Альфа',
    );
    expect(await noOverflow(page)).toBe(true);
    await expectGates(page);
  });

  test('«Выполнено» по разделу и «Отметить все выполненными»', async ({ page }) => {
    await mock(page);
    await open(page);
    const headline = page.locator('.li-sec').first();
    const one = page.waitForRequest((request) => request.url().endsWith('/linkedin/profile/done'));
    await headline.getByRole('button', { name: 'Выполнено' }).click();
    expect((await one).postDataJSON()).toEqual({ keys: ['headline'] });
    await expect(headline.locator('.li-done')).toHaveText('Выполнено');
    await expect(page.locator('#li-title')).toHaveText('Изменить 3 раздела из 7');
    await expectNotCovered(page, '.li-all .btn');
    const all = page.waitForRequest((request) => request.url().endsWith('/linkedin/profile/done'));
    await page.getByRole('button', { name: 'Отметить все выполненными' }).click();
    expect((await all).postDataJSON()).toEqual({
      keys: ['about', 'experience:e1', 'experience:e3', 'skills'],
    });
    await expect(page.locator('#li-title')).toHaveText('Все предложения выполнены');
    await expect(page.locator('.li-all')).toHaveCount(0);
  });

  test('«Скопировать», «Предложить заново» и листание «Вариант N из 3»', async ({ page }) => {
    await mock(page);
    await open(page);
    await page.getByRole('button', { name: 'Скопировать: Заголовок' }).click();
    await expect(page.getByText('Скопировано')).toBeVisible();
    await page.getByRole('button', { name: 'Другой вариант: Заголовок · осталось 2' }).click();
    await expect(page.locator('#li-new-headline')).toHaveText(
      'Руководитель разработки · финтех · Go, Kubernetes',
    );
    const variants = page.getByRole('group', { name: 'Варианты: Заголовок' });
    await expect(variants).toContainText('Вариант 2 из 3');
    await variants.getByRole('button', { name: 'Предыдущий вариант' }).click();
    await expect(page.locator('#li-new-headline')).toContainText('Engineering Manager');
    await expect(variants).toContainText('Вариант 1 из 3');
    await expect(
      page.getByRole('button', { name: 'Другой вариант: Заголовок · осталось 1' }),
    ).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
  });

  test('без импорта LinkedIn — «Импортировать из LinkedIn», разделов нет', async ({ page }) => {
    await mock(page, { view: { kind: 'no_import' } });
    await page.goto(PROFILE, { waitUntil: 'domcontentloaded' });
    const link = page.getByRole('link', { name: 'Импортировать из LinkedIn' });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute('href', '/app/account/connections');
    await expect(page.locator('.li-sec')).toHaveCount(0);
  });

  test('ошибка чтения: «Повторить» на месте', async ({ page }) => {
    await mock(page, { failRead: true });
    await page.goto(PROFILE, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить LinkedIn', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Повторить' })).toBeVisible();
  });

  test('390: последнее «Выполнено» не закрыто панелью «Отметить все» и навигацией', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'закреплённая панель — только на телефоне');
    await mock(page);
    await open(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectNotCovered(page, '.li-sec >> nth=5 >> .li-offer-a .btn');
    await expectNotCovered(page, '.li-all .btn');
  });

  test('снимки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!process.env.B640_SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    await mock(page);
    await open(page);
    const width = testInfo.project.name === 'desktop-1440' ? 1440 : 390;
    await page.screenshot({ path: `.s13-shots/linkedin-sections-${width}.png`, fullPage: true });
  });
});
