import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';
import { LADOGA_ID, mockLadoga, type LadogaOptions } from './vacancyCardFixture';

const SHOTS = process.env.B640_SHOTS;
const CARD_PATH = '/app/vacancies/cluster-0';

const requirement = (id: string, text: string) => ({
  id,
  text,
  sourceQuote: text,
  origin: 'explicit',
  importance: 'high',
  kind: 'experience',
  hard: false,
  stopFactor: false,
  skill: true,
});

const FIT_VIEW = {
  state: 'ready',
  requirements: [
    requirement('a', 'Kubernetes'),
    requirement('b', 'Найм руководителей'),
    requirement('c', 'English C1'),
    requirement('d', 'Go и PostgreSQL'),
  ],
  result: {
    candidateId: 'c',
    vacancyId: 'cluster-0',
    algorithmVersion: 'evidence-coverage-9',
    status: 'assessed',
    calculatedAt: '2026-11-11T09:00:00Z',
    dataState: 'confirmed',
    coveragePercent: 75,
    requiredCoverage: { matched: 2, total: 4, percent: 50 },
    coverage: { matched: 2, total: 4, unknown: 1, partial: 1 },
    reason: 'assessed',
    gates: {},
    assessments: [
      {
        requirementId: 'a',
        status: 'matched',
        evidence: [{ factId: 'f1', quote: 'Финтех Лаб · переход на Kubernetes, 2024' }],
      },
      {
        requirementId: 'b',
        status: 'partial',
        evidence: [{ factId: 'f2', quote: 'Финтех Лаб · нанимали разработчиков' }],
      },
      { requirementId: 'c', status: 'unknown', evidence: [] },
      {
        requirementId: 'd',
        status: 'matched',
        evidence: [{ factId: 'f3', quote: 'Финтех Лаб · Go, PostgreSQL' }],
      },
    ],
  },
} as unknown as VacancyFitView;

const DETAIL = {
  id: 'cluster-0',
  description:
    'О вакансии:\nКоманда платежей, 40 человек.\n\nЗадачи:\nРуководить развитием платёжной платформы.',
  truncated: false,
  skills: [],
  responsibilities: [],
  brief: {
    duties: [
      'Руководить развитием платёжной платформы и антифрода',
      'Нанимать и растить руководителей групп',
    ],
    requirements: ['Go и PostgreSQL', 'Kubernetes', 'Найм руководителей', 'English C1'],
    conditions: ['Гибрид, 2 дня в офисе в Москве', 'ДМС, оплата обучения'],
    opening: 'Команда платежей, 40 человек.',
  },
};

async function openCard(page: Page, remaining: number | null = 3): Promise<void> {
  // Свои маршруты — после общей заглушки: срабатывает последний зарегистрированный.
  await mockSignedInCabinet(page, { cabinetB640: true, firstVacancyFitView: FIT_VIEW });
  await page.route('**/api/v1/candidate/b640/application-quota', (route) =>
    route.fulfill({
      json: {
        data: {
          plan: 'free',
          limit: remaining === null ? null : 10,
          used: 7,
          remaining,
          renewsAt: null,
        },
        meta: {},
      },
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/detail', (route) =>
    route.fulfill({ json: { data: DETAIL } }),
  );
  await page.route('**/api/v1/vacancies/*/contacts', (route) =>
    route.fulfill({ json: { data: { contacts: [], job: null } } }),
  );
  await page.goto(CARD_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="v04"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.v4-fit-n').first()).toContainText('Совпадение 75 %');
}

test.describe('B654: карточка вакансии нового кабинета', () => {
  test('открывается по адресу: шапка, совпадение, шаги', async ({ page }) => {
    await openCard(page);
    await expect(page.locator('.r6-steps [aria-current="page"]')).toHaveText('Вакансия');
    await expect(page.locator('.v4-head .lead-title')).toBeVisible();
    await expect(page.locator('.v4-req-row')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Откликнуться' }).first()).toBeVisible();
  });

  test('«Почему 75 %» открывается и закрывается по Esc', async ({ page }) => {
    await openCard(page);
    const dialog = page.locator('.v4-fd');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Почему 75 %' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.v4-fd-l li')).toHaveCount(4);
    await expect(dialog.locator('.is-part')).toContainText('частично');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('B800: задачи, требования и условия под «Откликнуться»', async ({ page }) => {
    await openCard(page);
    const text = page.getByRole('region', { name: 'Вакансия', exact: true });
    await expect(text.locator('h4')).toHaveText(['Задачи', 'Требования', 'Условия']);
    await expect(text.locator('li').filter({ hasText: 'Найм руководителей' })).toContainText(
      'Найм руководителей · частично',
    );
    await expect(text.locator('.miss')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Текст вакансии' })).toHaveCount(0);
    const money = await page.locator('.v4-money').boundingBox();
    const box = await text.boundingBox();
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    if (phone) expect(box!.y).toBeLessThan(money!.y);
  });

  test('«Сохранить» отмечает вакансию', async ({ page }) => {
    await openCard(page);
    const save = page.locator('.v4-save:visible');
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
  });

  test('остаток откликов: «Осталось 3 отклика», без лимита строки нет', async ({ page }) => {
    await openCard(page);
    const line = page.locator('p.pm-line');
    await expect(line.locator('b')).toHaveText('Осталось 3 отклика');
    await expect(line.getByRole('link', { name: 'Перейти на Basic' })).toBeVisible();
    await page.unroute('**/api/v1/candidate/b640/application-quota');
    await page.route('**/api/v1/candidate/b640/application-quota', (route) =>
      route.fulfill({
        json: {
          data: { plan: 'max', limit: null, used: 0, remaining: null, renewsAt: null },
          meta: {},
        },
      }),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="v04"]')).toBeVisible();
    await expect(page.locator('p.pm-line')).toHaveCount(0);
  });

  test('гейты макетов на карточке', async ({ page }) => {
    await openCard(page);
    await expectGates(page);
  });

  test('на 390 «Откликнуться» закреплена внизу', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'телефон');
    await openCard(page);
    const dock = page.locator('.v4-act-main');
    const apply = dock.locator('.is-primary');
    await expect(apply).toBeVisible();
    const box = await apply.boundingBox();
    // Макет v04: кнопка в правой половине (195, 179), полоса 61 px.
    expect(Math.round(box?.x ?? 0)).toBe(195);
    expect(Math.round(box?.width ?? 0)).toBe(179);
    expect(Math.round((await dock.boundingBox())?.height ?? 0)).toBe(61);
    const height = page.viewportSize()?.height ?? 0;
    expect(box && box.y + box.height).toBeLessThanOrEqual(height);
    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasScroll).toBe(false);
  });

  test('снимки карточки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    await openCard(page);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      await page.goto(CARD_PATH, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.v4-fit-n').first()).toContainText('Совпадение 75 %');
      for (const width of desktop ? [1440, 1176] : [390]) {
        await page.setViewportSize({ width, height: desktop ? 900 : 844 });
        await page.screenshot({
          path: `.s13-shots/vacancy-card-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  });
});

async function openLadoga(page: Page, options: LadogaOptions = {}): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true, firstVacancyFitView: FIT_VIEW });
  await page.route('**/api/v1/candidate/b640/application-quota', (route) =>
    route.fulfill({
      json: { data: { plan: 'free', limit: 10, used: 7, remaining: 3, renewsAt: null }, meta: {} },
    }),
  );
  await page.route('**/api/v1/candidate/vacancies/*/detail', (route) =>
    route.fulfill({ json: { data: DETAIL } }),
  );
  await mockLadoga(page, options);
  await page.goto(`/app/vacancies/${LADOGA_ID}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="v04"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.v4-head .lead-title')).toHaveText('Руководитель разработки');
}

test.describe('B645: карточка вакансии — способы отклика, компания, знакомые', () => {
  test('все модули на месте и в порядке макета', async ({ page }) => {
    await openLadoga(page);
    const ways = page.locator('.ha-item');
    await expect(ways).toHaveCount(3);
    await expect(ways.nth(0)).toContainText('Через знакомого — Роман Ефимов');
    await expect(ways.nth(0)).toContainText('Рекомендуем');
    await expect(ways.nth(0)).toContainText('1-й круг · ваша связь в LinkedIn');
    await expect(ways.nth(0).getByRole('button', { name: 'Написать Роману' })).toBeVisible();
    await expect(ways.nth(1)).toContainText('hh.ru — письмо и ваше резюме');
    await expect(ways.nth(2)).toContainText('Сайт компании — анкета из 3 вопросов');
    const about = page.locator('.v4-about-co');
    // На 390 «О компании» свёрнута, на 1440 раскрыта: раскрываем, если свёрнута.
    if (!(await about.evaluate((node) => (node as HTMLDetailsElement).open)))
      await about.locator('summary').click();
    await expect(about).toContainText('Банки');
    await expect(about).toContainText('Алина Громова · технический рекрутер');
    await expect(about.getByRole('link', { name: 'Откликнуться напрямую' })).toBeVisible();
    await expect(about.locator('.v4-co-more')).toContainText('Ещё 2 вакансии · 3 знакомых');
    await expect(page.locator('.v4-money')).toContainText('Ваши ожидания внутри вилки');
    const order = [
      '.v4-money',
      '.v4-about-co',
      '.v4-fold:has-text("Знакомые в компании · 3")',
      '.v4-fold:has-text("Письмо и резюме")',
    ];
    const tops: number[] = [];
    for (const selector of order) {
      const box = await page.locator(selector).first().boundingBox();
      tops.push(box?.y ?? -1);
    }
    expect(tops.every((top, index) => top >= 0 && (index === 0 || top > tops[index - 1]!))).toBe(
      true,
    );
  });

  test('«Написать Роману» открывает шаг «Отклик» с черновиком (a02d)', async ({ page }) => {
    await openLadoga(page);
    await page.route('**/api/v1/candidate/b640/contact-messages/m1', (route) =>
      route.fulfill({ status: 204 }),
    );
    await page.getByRole('button', { name: 'Написать Роману' }).click();
    await expect(page.locator('section.lead .lead-title')).toContainText('Написать Роману Ефимову');
    await expect(page.locator('.lk-inline .lk-lbl')).toHaveText('Черновик');
    await expect(page.locator('.lk-inline textarea')).toHaveValue(/Мы работали вместе/u);
    await expect(page.locator('.r6-steps [aria-current="page"]')).toHaveText('Отклик');
    await page.getByRole('button', { name: 'Не отправлять' }).click();
    await expect(page.locator('.ha-item')).toHaveCount(3);
  });

  test('B682: «Другой вариант» сообщения — «Что поменять», листание, поле 44 (a02d)', async ({
    page,
  }, testInfo) => {
    await openLadoga(page);
    const variant = {
      id: 'v1',
      position: 1,
      text: 'Роман, привет!',
      wish: { chips: ['shorter'], text: '' },
      createdAt: '2026-11-24T10:00:00.000Z',
      payload: null,
    };
    let body: unknown = null;
    await page.route('**/api/v1/candidate/b640/contact-messages/m1/variants', (route) => {
      body = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: { data: { variant, variants: [variant], remaining: 2 } },
      });
    });
    await page.getByRole('button', { name: 'Написать Роману' }).click();
    const button = page.getByRole('button', { name: 'Другой вариант · 3' });
    await button.click();
    const pop = page.getByRole('dialog', { name: 'Что поменять' });
    const wish = await pop.locator('.alt-wish').boundingBox();
    expect(wish!.height).toBe(44);
    const box = await pop.boundingBox();
    if (testInfo.project.name.includes('390')) {
      expect(box!.x).toBe(0);
      expect(box!.width).toBe(page.viewportSize()!.width);
    }
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: testInfo.outputPath('message-wish.png') });
    await pop.getByRole('button', { name: 'Короче' }).click();
    await pop.getByRole('button', { name: 'Сделать вариант' }).click();
    const field = page.locator('.lk-inline textarea.lk-draft');
    await expect(field).toHaveValue('Роман, привет!');
    expect(body).toMatchObject({ wish: { chips: ['shorter'], text: '' } });
    const sw = page.getByRole('group', { name: 'Варианты сообщения' });
    await expect(sw).toContainText('2 из 2');
    await page.screenshot({ path: testInfo.outputPath('message-variant.png') });
    await sw.getByRole('button', { name: 'Предыдущий вариант' }).click();
    await expect(field).toHaveValue(/Мы работали вместе/u);
    // Ушли и открыли снова: тот же черновик, вариант и остаток на месте.
    await page.route('**/api/v1/candidate/text-variants?kind=message&subjectId=m1', (route) =>
      route.fulfill({ json: { data: { variants: [variant], remaining: 2 } } }),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Написать Роману' }).click();
    await expect(sw).toContainText('1 из 2');
    await expect(page.getByRole('button', { name: 'Другой вариант · 2' })).toBeVisible();
    await expectGates(page);
  });

  test('знакомых нет: «Как откликнуться» остаётся с hh.ru и сайтом', async ({ page }) => {
    await openLadoga(page, { noPeople: true });
    const ways = page.locator('.ha-item');
    await expect(ways).toHaveCount(2);
    await expect(ways.nth(0)).toContainText('hh.ru');
    await expect(ways.nth(1)).toContainText('Сайт компании');
    await expect(page.getByText('Через знакомого')).toHaveCount(0);
    await expect(page.locator('.v4-fold-s', { hasText: 'Знакомые в компании' })).toHaveCount(0);
    await expect(page.locator('.v4-about-co')).toContainText('Алина Громова');
  });
});
