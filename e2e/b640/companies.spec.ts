import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const LIST_PATH = '/app/vacancies/companies';
const KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6';

const NAMES = [
  ['Гринкод', 'Москва', 1, 1, true],
  ['Лента Финанс', 'Москва', 2, 0, true],
  ['Арка Холдинг', 'Москва', 2, 1, false],
  ['Ладога Банк', 'Москва', 1, 2, false],
  ['Маркет Софт', 'Москва', 1, 1, false],
  ['Сфера Пэй', 'Санкт-Петербург', 1, 0, false],
  ['Нордлайн', 'Санкт-Петербург', 1, 0, false],
  ['Ритейл Грид', 'Москва', 1, 0, false],
  ['Т-Технологии', 'Москва', 1, 1, false],
  ['Карго Тех', 'Москва', 1, 0, false],
] as const;

const company = (
  [name, location, vacancyCount, contactsCount, want]: (typeof NAMES)[number],
  index: number,
) => ({
  key: index === 3 ? KEY : `${String(index).padStart(2, '0')}${'f'.repeat(22)}`,
  name,
  location,
  industry: 'Банки',
  vacancyCount,
  contactsCount,
  contactsImportedAt: '2026-11-10T09:00:00.000Z',
  want,
  nextStep: null,
  hasRecruiter: index === 3,
  recruiterSearchStatus: 'idle',
  sources: [{ name: 'hh.ru', observedAt: '2026-11-10T09:00:00.000Z' }],
  vacancies: [],
  recruiters:
    index === 3
      ? [
          {
            id: 'r1',
            companyKey: KEY,
            vacancyId: 'cluster-0',
            fullName: 'Алина Громова',
            roleTitle: 'технический рекрутер',
            email: null,
            emailStatus: 'unverified',
            phone: null,
            telegram: null,
            whatsapp: null,
            linkedinUrl: null,
            githubUrl: null,
            twitterUrl: null,
            source: 'vacancy',
            sourceLabel: 'hh.ru',
            sourceDate: '2026-11-11T09:00:00.000Z',
            isHypothesis: false,
          },
        ]
      : [],
});

const COMPANIES = NAMES.map(company);
const wants = new Set(COMPANIES.filter((item) => item.want).map((item) => item.key));

async function mockCompanies(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route('**/api/v1/candidate/companies?*', (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('filter');
    const items = COMPANIES.map((item) => ({ ...item, want: wants.has(item.key) })).filter(
      (item) => filter !== 'want' || item.want,
    );
    return route.fulfill({
      json: {
        data: {
          items,
          total: filter === 'want' ? items.length : 132,
          offset: 0,
          limit: 20,
          sort: 'default',
          filter: filter ?? 'all',
          filterCounts: { all: 132, want: wants.size, contacts: 5, recruiter: 4 },
          linkedin: {
            status: 'connected',
            importedAt: '2026-11-10T09:00:00.000Z',
            contactsImported: true,
          },
          searchConsentGranted: false,
        },
      },
    });
  });
  await page.route(`**/api/v1/candidate/companies/${KEY}?*`, (route) => {
    const base = COMPANIES[3]!;
    const vacancies = [
      {
        id: 'cluster-0',
        title: 'Руководитель разработки',
        location: 'Москва',
        sourceName: 'hh.ru',
        sourceDate: '2026-11-11T09:00:00.000Z',
        href: '',
      },
    ];
    return route.fulfill({
      json: {
        data: {
          company: { ...base, want: wants.has(KEY), vacancies },
          vacancies,
          totalVacancies: 1,
          vacancyOffset: 0,
          nextOffset: null,
        },
      },
    });
  });
  await page.route(`**/api/v1/candidate/companies/*/want`, (route) => {
    const key = new URL(route.request().url()).pathname.split('/').at(-2)!;
    if (route.request().method() === 'DELETE') wants.delete(key);
    else wants.add(key);
    return route.fulfill({ json: { data: { ok: true } } });
  });
}

async function openList(page: Page): Promise<void> {
  await mockCompanies(page);
  await page.goto(LIST_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="v10"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('tr.co-row')).toHaveCount(10);
}

async function openCompany(page: Page): Promise<void> {
  await mockCompanies(page);
  await page.goto(`${LIST_PATH}/${KEY}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="v10b"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#co-name')).toContainText('Ладога Банк');
}

test.describe('B655: «Компании и люди» нового кабинета', () => {
  test.beforeEach(() => {
    wants.clear();
    for (const item of COMPANIES) if (item.want) wants.add(item.key);
  });

  test('список: заголовок, фильтры, строки и «Показать ещё»', async ({ page }) => {
    await openList(page);
    await expect(page.locator('.co-h')).toHaveText('132 компании в подборке');
    await expect(page.locator('.chip')).toHaveText([
      'Хочу · 2',
      'Есть контакты в сети · 5',
      'Рекрутер известен · 4',
    ]);
    await expect(page.locator('.vl-foot')).toContainText('Показать ещё 20 · осталось 122');
  });

  test('найти компанию, отметить «Хочу» и отменить', async ({ page }) => {
    await openList(page);
    const row = page.locator('tr.co-row', { hasText: 'Ладога Банк' });
    const want = row.getByRole('button', { name: 'Хочу в компанию: Ладога Банк' });
    await want.click();
    await expect(want).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(want).toHaveAttribute('aria-pressed', 'false');
  });

  test('карточка компании: вакансии, люди, путь назад', async ({ page }) => {
    await openList(page);
    await page.locator('a.co-nm', { hasText: 'Ладога Банк' }).click();
    await expect(page.locator('[data-b640-node="v10b"]')).toBeVisible();
    await expect(page.locator('.co-vrow')).toHaveCount(1);
    await expect(page.locator('.co-person')).toContainText('Алина Громова');
    await page.getByRole('button', { name: 'Хочу в компанию: Ладога Банк' }).click();
    await expect(page.locator('.co-wantline')).toContainText('В списке «Хочу»');
    await page.locator('.co-wantline .row-act').click();
    await expect(page.locator('.co-wantline')).toHaveCount(0);
  });

  test('гейты макетов на списке и карточке', async ({ page }) => {
    await openList(page);
    await expectGates(page);
    await openCompany(page);
    await expectGates(page);
  });

  test('снимки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    await mockCompanies(page);
    for (const [name, path, node] of [
      ['companies', LIST_PATH, 'v10'],
      ['company', `${LIST_PATH}/${KEY}`, 'v10b'],
    ] as const) {
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
