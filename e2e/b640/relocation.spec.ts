import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCareer, type CareerOptions } from './careerFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const PATH = '/app/career/relocation';
const screenOf = (page: Page) => page.locator('[data-b640-node="c06"]');

const ready = (currency: string, median: number, vacancies: number, city: string) => ({
  state: 'ready',
  currency,
  low: Math.round(median * 0.85),
  median,
  high: Math.round(median * 1.15),
  sampleSize: 40,
  observedAt: '2026-11-10T09:00:00.000Z',
  rateDate: '2026-11-18',
  sources: ['hh.ru'],
  vacancies,
  city,
});

const OPTIONS: CareerOptions = {
  relocationPay: {
    RS: ready('RSD', 600_000, 62, 'belgrade'),
    CY: ready('EUR', 7_000, 17, 'limassol'),
    DE: ready('EUR', 6_500, 120, 'berlin'),
    AE: { state: 'thin', vacancies: 9, city: 'dubai' },
  },
  relocationCompanies: 24,
};

test.describe('B653 C06: «Релокация»', () => {
  test.describe.configure({ timeout: 90_000 });
  test('страны: на руки, налоги, право работать, компании; гейты', async ({ page }) => {
    await openCareer(page, PATH, OPTIONS);
    const screen = screenOf(page);
    const serbia = screen.locator('.rl-row').filter({ hasText: 'Сербия' });
    await expect(serbia).toBeVisible({ timeout: 15_000 });
    await expect(serbia.locator('.row-sub').first()).toHaveText('Белград');
    await expect(serbia.getByText(/^на руки \d/u)).toBeVisible();
    await expect(serbia.getByText('Право работать: неизвестно · виза не проверена')).toBeVisible();
    await expect(serbia.getByText('62 вакансии')).toBeVisible();
    await serbia.locator('summary.rl-sum').click();
    await serbia.getByText('Налоги и взносы').click();
    await expect(serbia.getByRole('definition').first()).toHaveText(/600\s000\sRSD/u);
    await expect(serbia.getByText('Пенсионное и инвалидное страхование')).toBeVisible();
    const emirates = screen.locator('.rl-row').filter({ hasText: 'ОАЭ' });
    await expect(emirates.getByText('Зарплаты: мало данных')).toBeVisible();
    await expect(emirates.getByText('Налоги и взносы')).toHaveCount(0);
    await expect(screen.getByRole('link', { name: /Смотреть компании · 24/u })).toHaveAttribute(
      'href',
      '/app/vacancies/companies?relocation=true',
    );
    await expectGates(page);
  });

  test('снимки: c06-relokaciya', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    await openCareer(page, PATH, OPTIONS);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      await page.goto(PATH, { waitUntil: 'domcontentloaded' });
      await expect(screenOf(page).locator('.rl-row').first()).toBeVisible({ timeout: 15_000 });
      for (const width of desktop ? [1440] : [390]) {
        await page.setViewportSize({ width, height: desktop ? 900 : 844 });
        await page.screenshot({
          path: `.s13-shots/c06-relokaciya-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  });
});
