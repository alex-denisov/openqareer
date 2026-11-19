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
    // Главное действие — одна кнопка в полосе act-dock, как в макете c06 (B645);
    // на 390 во всю ширину поля. «Изменить места» — вторичная ссылка.
    const dock = screen.locator('.act-dock');
    await expect(dock.getByRole('button')).toHaveText(['Уточнить: кто едет и бюджет']);
    const places = screen.locator('.lead .row-act', { hasText: 'Изменить места' });
    await expect(places).toBeVisible();
    // Как в макете: строчная ссылка по ширине текста, отступ −8 от края карточки (B645 c06).
    const placesBox = await places.boundingBox();
    const leadBox = await screen.locator('.lead').first().boundingBox();
    expect(placesBox?.width ?? 0).toBeLessThan(160);
    const padding = await screen
      .locator('.lead')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
    expect(Math.round((placesBox?.x ?? 0) - (leadBox?.x ?? 0))).toBe(padding - 8);
    const button = await dock.getByRole('button').boundingBox();
    if ((page.viewportSize()?.width ?? 0) < 768) {
      expect(Math.round(button?.width ?? 0)).toBe(358);
    } else {
      const bar = await dock.boundingBox();
      expect(Math.round(bar?.width ?? 0)).toBe(1080);
      expect(Math.round(button?.width ?? 0)).toBeGreaterThanOrEqual(260);
    }
    await expectGates(page);
  });

  test('траты страны: добавить раздел с согласием, итог после всех разделов', async ({ page }) => {
    const calls = await openCareer(page, PATH, OPTIONS);
    const germany = screenOf(page).locator('.rl-row').filter({ hasText: 'Германия' });
    await expect(germany.getByText('Кто едет: только вы')).toBeVisible({ timeout: 15_000 });
    await germany.getByRole('button', { name: /Добавить расходы · 9/u }).click();
    await germany.getByLabel('Жильё, EUR в месяц').fill('1500');
    const save = germany.getByRole('button', { name: 'Сохранить' });
    await expect(save).toBeDisabled();
    await germany.getByLabel(/Даю согласие на обработку данных о мобильности/u).check();
    await save.click();
    await expect(germany.getByRole('button', { name: /1\s500\s€ в месяц/u })).toBeVisible();
    await expect(germany.getByRole('button', { name: /Добавить расходы · 8/u })).toBeVisible();
    expect(calls.consents).toHaveLength(1);
    expect(calls.scenarios).toHaveLength(1);
    expect(calls.scenarios[0]).toMatchObject({
      countryCode: 'DE',
      city: 'Берлин',
      householdSize: 1,
      grossAnnualIncome: 78_000,
      expenses: { rent: { amount: 1500, currency: 'EUR', period: 'monthly' } },
    });
    await expect(germany.getByText('Остаётся на жизнь')).toHaveCount(0);
  });

  test('кто едет: партнёр и дети уходят в анкету', async ({ page }) => {
    const profile = {
      schemaVersion: 1,
      revision: 3,
      currentStep: 'family',
      skippedSteps: [],
      citizenshipDocuments: { citizenshipCountryCodes: ['RU'], documents: [] },
      education: { education: [], certificates: [] },
      family: {
        partnerStatus: 'unknown',
        relocationTimeframe: 'unknown',
        familyMovePlan: 'undecided',
      },
      languages: { languages: [] },
      selectedCountryCodes: [],
      updatedAt: null,
    };
    const calls = await openCareer(page, PATH, {
      ...OPTIONS,
      relocationConsent: true,
      relocationProfile: profile,
    });
    await screenOf(page)
      .getByRole('button', { name: 'Уточнить: кто едет и бюджет' })
      .click({ timeout: 15_000 });
    const dialog = page.getByRole('dialog', { name: 'Кто едет' });
    await dialog.getByRole('button', { name: 'Я и партнёр' }).click();
    await dialog.getByLabel('Детей').fill('2');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls.family).toEqual([
      {
        partnerStatus: 'has_partner',
        childrenCount: 2,
        relocationTimeframe: 'unknown',
        familyMovePlan: 'together',
      },
    ]);
    expect(calls.consents).toHaveLength(0);
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
