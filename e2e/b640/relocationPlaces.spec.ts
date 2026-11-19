import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCareer, type CareerOptions } from './careerFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const PATH = '/app/career/relocation';
const screenOf = (page: Page) => page.locator('[data-b640-node="c06"]');

const CITIES = [
  { slug: 'saint-petersburg', name: 'Санкт-Петербург', vacancies: 214 },
  { slug: 'kazan', name: 'Казань', vacancies: 63 },
];

const cityPay = (low: number, median: number, high: number) => ({
  state: 'ready',
  scope: 'role',
  currency: 'RUB',
  low,
  median,
  high,
  sampleSize: 24,
  observedAt: '2026-11-18T09:00:00.000Z',
});

const OPTIONS: CareerOptions = {
  relocationPay: {
    RS: {
      state: 'ready',
      currency: 'RSD',
      low: 510_000,
      median: 600_000,
      high: 690_000,
      sampleSize: 40,
      observedAt: '2026-11-10T09:00:00.000Z',
      rateDate: '2026-11-18',
      sources: ['hh.ru'],
      vacancies: 62,
      city: 'belgrade',
    },
  },
  relocationCities: CITIES,
  relocationCityPay: {
    'Санкт-Петербург': cityPay(330_000, 390_000, 450_000),
    Казань: cityPay(270_000, 320_000, 370_000),
  },
  relocationPlaces: [
    { kind: 'country', code: 'RS', skipped: [] },
    { kind: 'city', slug: 'saint-petersburg', skipped: [] },
    { kind: 'city', slug: 'kazan', skipped: [] },
  ],
};

test.describe('B672 C06: города России и сохранённые места', () => {
  test.describe.configure({ timeout: 90_000 });

  test('страна и города России: вилка города, на руки, переключатель; гейты', async ({ page }) => {
    await openCareer(page, PATH, OPTIONS);
    const screen = screenOf(page);
    await expect(
      screen.getByRole('heading', {
        name: '3 места, куда можно уехать: 1 страна и 2 города России',
      }),
    ).toBeVisible({ timeout: 15_000 });
    const kazan = screen.locator('.rl-row').filter({ hasText: 'Казань' });
    await expect(kazan.getByText('Вилка в городе: 270–370 тыс. ₽')).toBeVisible();
    await expect(kazan.getByText(/^на руки 276\s000\s₽$/u)).toBeVisible();
    await expect(kazan.getByText('63 вакансии')).toBeVisible();
    await expect(kazan.getByText(/Право работать/u)).toHaveCount(0);
    await screen.locator('.seg-ctl label').filter({ hasText: 'Внутри страны' }).click();
    await expect(screen.locator('.rl-row').filter({ hasText: 'Сербия' })).toHaveCount(0);
    await expect(screen.locator('.rl-row')).toHaveCount(2);
    await expectGates(page);
  });

  test('«Не про меня»: раздел уходит из недостающих и сохраняется у места', async ({ page }) => {
    const calls = await openCareer(page, PATH, {
      ...OPTIONS,
      relocationConsent: true,
      relocationPlaces: [{ kind: 'city', slug: 'kazan', skipped: [] }],
    });
    const kazan = screenOf(page).locator('.rl-row').filter({ hasText: 'Казань' });
    await kazan.getByRole('button', { name: /Добавить расходы · 9/u }).click({ timeout: 15_000 });
    await kazan.getByLabel('Раздел').selectOption({ label: 'Дети и учёба' });
    await kazan.getByRole('button', { name: 'Не про меня' }).click();
    await expect(kazan.getByRole('button', { name: /Добавить расходы · 8/u })).toBeVisible();
    await expect(
      kazan.locator('.rl-cost').filter({ hasText: 'Дети и учёба' }).getByRole('button'),
    ).toHaveText('Не про меня');
    expect(calls.places).toEqual([[{ kind: 'city', slug: 'kazan', skipped: ['education'] }]]);
    expect(calls.scenarios).toHaveLength(0);
  });

  test('«Изменить места»: город России добавляется с согласием и остаётся в списке', async ({
    page,
  }) => {
    const calls = await openCareer(page, PATH, { ...OPTIONS, relocationPlaces: undefined });
    const screen = screenOf(page);
    await screen.getByRole('button', { name: 'Изменить места' }).click({ timeout: 15_000 });
    const dialog = page.getByRole('dialog', { name: 'Куда смотреть' });
    await dialog.getByLabel(/^Казань/u).check();
    const save = dialog.getByRole('button', { name: 'Сохранить' });
    await expect(save).toBeDisabled();
    await dialog.getByLabel(/Даю согласие на обработку данных о мобильности/u).check();
    await save.click();
    await expect(dialog).toHaveCount(0);
    const saved = calls.places[0] as { kind: string; slug?: string }[];
    expect(saved.filter((place) => place.kind === 'country')).toHaveLength(5);
    expect(saved.at(-1)).toEqual({ kind: 'city', slug: 'kazan', skipped: [] });
    await expect(screen.locator('.rl-row').filter({ hasText: 'Казань' })).toBeVisible();
  });

  test('снимки: c06-relokaciya с городами России', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    await openCareer(page, PATH, OPTIONS);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      await page.goto(PATH, { waitUntil: 'domcontentloaded' });
      await expect(screenOf(page).locator('.rl-row').first()).toBeVisible({ timeout: 15_000 });
      const width = desktop ? 1440 : 390;
      await page.setViewportSize({ width, height: desktop ? 900 : 844 });
      await page.screenshot({
        path: `.s13-shots/c06-places-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  });
});
