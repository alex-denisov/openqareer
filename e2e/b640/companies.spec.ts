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
  recruiters: [],
  relocation: index % 3 === 0 ? { sourceLabel: 'hh.ru', readAt: '2026-11-10' } : null,
});

const vacancy = (id: string, title: string, percent?: number) => ({
  cluster: {
    id,
    canonicalTitle: title,
    canonicalCompany: 'Ладога Банк',
    canonicalLocation: 'Москва',
    isRemote: false,
    workFormat: 'hybrid',
    salary: { from: 480000, to: 580000, currency: 'RUR' },
    skills: [],
    descriptionSummary: '',
    primaryUrl: '',
    sources: [],
    firstObservedAt: '2026-11-11T09:00:00.000Z',
    lastSeenAt: '2026-11-11T09:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  },
  explanation: {
    clusterId: id,
    roleMatch: 'target',
    matchingPoints: [],
    missingPoints: [],
    summary: '',
    calculatedAt: '',
    ...(percent
      ? {
          fitView: {
            state: 'ready',
            result: {
              status: 'assessed',
              dataState: 'known',
              coveragePercent: percent,
              coverage: { total: 5 },
            },
          },
        }
      : {}),
  },
});

const PEOPLE = [
  {
    id: 'p1',
    circle: 1,
    name: 'Роман Ефимов',
    roleTitle: 'руководитель группы платежей',
    evidence: 'Общее место работы: «Сфера Платежи», 2018–2021',
    nextStep: 'write_known_contact',
    vacancyId: 'cluster-0',
    platformMember: false,
  },
  {
    id: 'p2',
    circle: 2,
    name: null,
    roleTitle: null,
    evidence: 'Знаком с участником платформы — тот согласен представлять кандидатов',
    nextStep: 'ask_for_introduction',
    vacancyId: 'cluster-0',
    platformMember: true,
  },
  {
    id: 'p3',
    circle: 3,
    name: 'Алина Громова',
    roleTitle: 'технический рекрутер',
    evidence: 'Холодный отклик по вакансии; ничего не отправлено.',
    nextStep: 'cold_application',
    vacancyId: 'cluster-0',
    platformMember: false,
  },
];

const COMPANIES = NAMES.map(company);
const wants = new Set(COMPANIES.filter((item) => item.want).map((item) => item.key));

async function mockCompanies(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route('**/api/v1/candidate/b640/companies?*', (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('filter');
    const relocation = url.searchParams.get('relocation') === '1';
    const city = url.searchParams.get('city');
    const items = COMPANIES.map((item) => ({ ...item, want: wants.has(item.key) }))
      .filter((item) => filter !== 'want' || item.want)
      .filter((item) => !relocation || item.relocation)
      .filter((item) => !city || item.location === city);
    const narrowed = filter === 'want' || relocation || city;
    return route.fulfill({
      json: {
        data: {
          items,
          total: narrowed ? items.length : 132,
          offset: 0,
          limit: 20,
          sort: 'default',
          filter: filter ?? 'all',
          filterCounts: { all: 132, want: wants.size, contacts: 5, recruiter: 4, relocation: 4 },
          linkedin: {
            status: 'connected',
            importedAt: '2026-11-10T09:00:00.000Z',
            contactsImported: true,
          },
          searchConsentGranted: false,
          relocation,
          city,
          cities: [
            { name: 'Москва', count: 8 },
            { name: 'Санкт-Петербург', count: 2 },
            { name: 'Тула', count: 0 },
          ],
        },
      },
    });
  });
  await page.route(`**/api/v1/candidate/b640/companies/${KEY}/people?*`, (route) =>
    route.fulfill({ json: { data: { items: PEOPLE, total: 3, offset: 0, nextOffset: null } } }),
  );
  await page.route(`**/api/v1/candidate/b640/companies/${KEY}?*`, (route) =>
    route.fulfill({
      json: {
        data: {
          company: { ...COMPANIES[3]!, want: wants.has(KEY) },
          roleVacancies: [vacancy('cluster-0', 'Руководитель разработки', 86)],
          roleTotal: 1,
          roleNextOffset: null,
          otherVacancies: [
            vacancy('cluster-8', 'Руководитель группы QA'),
            vacancy('cluster-9', 'Аналитик данных'),
          ],
          otherTotal: 2,
          applications: {},
        },
      },
    }),
  );
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

test.describe('B655/B677: «Компании и люди» нового кабинета', () => {
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
      'Релокация · 4',
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
    await expect(page.locator('.co-vrow .vt-fit')).toContainText('86');
    await expect(page.locator('.more-n summary')).toHaveText('Другие вакансии компании · 2');
    await expect(page.locator('.co-person .tag')).toHaveText(['круг 1', 'круг 2', 'круг 3']);
    await expect(page.locator('.co-person').nth(1)).toContainText('Участник платформы');
    await page.getByRole('button', { name: 'Хочу в компанию: Ладога Банк' }).click();
    await expect(page.locator('.co-wantline')).toContainText('В списке «Хочу»');
    await page.locator('.co-wantline .row-act').click();
    await expect(page.locator('.co-wantline')).toHaveCount(0);
  });

  test('релокация в городе без компаний — v10g и путь к удалённой работе', async ({ page }) => {
    await openList(page);
    await page.getByRole('button', { name: 'Фильтры' }).click();
    await page.getByRole('switch').check();
    await page.getByLabel('Город').selectOption('Тула');
    await page.getByRole('button', { name: 'Показать компании' }).click();
    await expect(page.locator('.co-h')).toHaveText('Компании с релокацией');
    await expect(page.locator('.vt-chip')).toHaveText(['Релокация', 'Тула']);
    await expect(page.locator('.vl-empty')).toContainText(
      'В этом городе компаний с релокацией не нашли',
    );
    await expect(page.getByRole('link', { name: 'Посмотреть удалённую работу' })).toBeVisible();
    await expectGates(page);
    await page.getByRole('button', { name: 'Сбросить всё' }).click();
    await expect(page.locator('tr.co-row')).toHaveCount(10);
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
