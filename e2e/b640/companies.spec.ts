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

const vacancy = (
  id: string,
  title: string,
  salary: readonly [number, number],
  seen: string,
  percent?: number,
) => ({
  cluster: {
    id,
    canonicalTitle: title,
    canonicalCompany: 'Ладога Банк',
    canonicalLocation: 'Москва',
    isRemote: false,
    workFormat: 'hybrid',
    salary: { from: salary[0], to: salary[1], currency: 'RUR' },
    skills: [],
    descriptionSummary: '',
    primaryUrl: '',
    sources: [],
    firstObservedAt: seen,
    lastSeenAt: seen,
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

const person = (id: string, circle: 1 | 2 | 3, fields: Record<string, unknown>) => ({
  id,
  circle,
  name: null,
  roleTitle: null,
  evidence: null,
  vacancyId: 'cluster-0',
  platformMember: false,
  ...fields,
});

const PEOPLE = [
  person('p1', 1, {
    name: 'Роман Ефимов',
    roleTitle: 'руководитель группы платежей',
    evidence: 'общее место работы в вашем резюме: «Сфера Платежи», 2018–2021',
    nextStep: 'write_known_contact',
  }),
  person('p2', 2, {
    name: 'Наталья Седова',
    roleTitle: 'директор по разработке',
    evidence: 'Знакома с вашим контактом Роман Ефимов · импорт контактов LinkedIn, 10.11',
    nextStep: 'ask_for_introduction',
  }),
  person('p3', 2, {
    roleTitle: 'Руководитель платформы',
    evidence: 'Знаком с участником openqareer — тот согласен представлять кандидатов',
    nextStep: 'ask_for_introduction',
    platformMember: true,
  }),
  person('p4', 3, {
    name: 'Алина Громова',
    roleTitle: 'технический рекрутер',
    evidence: 'рекрутер вакансии на hh.ru, 11.11',
    nextStep: 'cold_application',
  }),
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
          total: narrowed ? items.length : 122,
          offset: 0,
          limit: 20,
          sort: 'default',
          filter: filter ?? 'all',
          filterCounts: { all: 132, want: wants.size, contacts: 5, recruiter: 4, relocation: 9 },
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
    route.fulfill({ json: { data: { items: PEOPLE, total: 4, offset: 0, nextOffset: null } } }),
  );
  await page.route(`**/api/v1/candidate/b640/companies/${KEY}?*`, (route) =>
    route.fulfill({
      json: {
        data: {
          company: { ...COMPANIES[3]!, want: wants.has(KEY) },
          roleVacancies: [
            vacancy(
              'cluster-0',
              'Руководитель разработки',
              [480000, 580000],
              '2026-11-11T09:00:00.000Z',
              86,
            ),
          ],
          roleTotal: 1,
          roleNextOffset: null,
          otherVacancies: [
            vacancy(
              'cluster-8',
              'Руководитель группы QA',
              [320000, 380000],
              '2026-11-09T09:00:00.000Z',
            ),
            vacancy('cluster-9', 'Аналитик данных', [220000, 280000], '2026-11-06T09:00:00.000Z'),
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
      'Релокация · 9',
    ]);
    await expect(page.locator('.vl-foot')).toContainText('Показать ещё 20 · осталось 112');
  });

  test('найти компанию, отметить «Хочу» и отменить', async ({ page }) => {
    await openList(page);
    const row = page.locator('tr.co-row', { hasText: 'Ладога Банк' });
    const want = row.getByRole('button', { name: 'Хочу в компанию: Ладога Банк' });
    await want.click();
    await expect(want).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(want).toHaveAttribute('aria-pressed', 'false');
    if ((page.viewportSize()?.width ?? 1440) >= 768) {
      // B645: кнопка строчная и прижата к правому краю ячейки, как в макете.
      const edge = await want.evaluate((node) => {
        const cell = node.closest('td')!.getBoundingClientRect();
        const padding = parseFloat(getComputedStyle(node.closest('td')!).paddingInlineEnd);
        return {
          display: getComputedStyle(node).display,
          gap: Math.round(cell.right - padding - node.getBoundingClientRect().right),
        };
      });
      expect(edge).toEqual({ display: 'inline-flex', gap: 0 });
    }
  });

  test('карточка компании: вакансии, люди, путь назад', async ({ page }) => {
    await openList(page);
    await page.locator('a.co-nm', { hasText: 'Ладога Банк' }).click();
    await expect(page.locator('[data-b640-node="v10b"]')).toBeVisible();
    await expect(page.locator('.co-vrow')).toHaveCount(1);
    await expect(page.locator('.co-vrow .vt-fit')).toContainText('86');
    await expect(page.locator('.more-n summary')).toHaveText('Другие вакансии компании · 2');
    await expect(page.locator('.co-person .tag')).toHaveText([
      'круг 1',
      'круг 2',
      'круг 2',
      'круг 3',
    ]);
    await expect(page.locator('.co-person').nth(2)).toContainText('имя скрыто');
    // B645: на 390 действия шапки закреплены над нижней навигацией, на 1440 — в шапке.
    const mobile = (page.viewportSize()?.width ?? 1440) < 768;
    await expect(page.locator('.co-head .actions')).toHaveCount(mobile ? 0 : 1);
    await expect(page.locator('.act-dock')).toHaveCount(mobile ? 1 : 0);
    if (mobile) {
      const dock = await page.locator('.act-dock').boundingBox();
      const nav = await page.locator('.bottomnav').boundingBox();
      if (dock && nav) expect(dock.y + dock.height).toBeLessThanOrEqual(nav.y + 1);
    }
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

/** Карточка без знакомых: вакансий по ролям `roles` штук (0 — ни одной). */
async function openWithoutPeople(page: Page, roles: number): Promise<void> {
  await mockCompanies(page);
  await page.route(`**/api/v1/candidate/b640/companies/${KEY}/people?*`, (route) =>
    route.fulfill({ json: { data: { items: [], total: 0, offset: 0, nextOffset: null } } }),
  );
  await page.route(`**/api/v1/candidate/b640/companies/${KEY}?*`, (route) =>
    route.fulfill({
      json: {
        data: {
          company: { ...COMPANIES[3]!, want: false },
          roleVacancies: Array.from({ length: roles }, (_, i) =>
            vacancy(
              `cluster-${i}`,
              `Руководитель ${i}`,
              [480000, 580000],
              '2026-11-11T09:00:00.000Z',
              80,
            ),
          ),
          roleTotal: roles,
          roleNextOffset: null,
          otherVacancies: [],
          otherTotal: 0,
          applications: {},
        },
      },
    }),
  );
  await page.goto(`${LIST_PATH}/${KEY}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="v10b"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Знакомых в компании не нашли')).toBeVisible();
}

/** Кнопка видна целиком и не закрыта закреплённой панелью или навигацией (проверка B645 на 390). */
async function expectNotCovered(page: Page, selector: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const free = await page.locator(selector).evaluate((node) => {
    node.scrollIntoView({ block: 'nearest' });
    const box = node.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return Boolean(hit && node.contains(hit));
  });
  expect(free).toBe(true);
}

test.describe('B645: «Люди компании» без знакомых — следующий шаг по данным', () => {
  test('одна вакансия — «Откликнуться на вакансию» ведёт в её карточку', async ({ page }) => {
    await openWithoutPeople(page, 1);
    const action = page.locator('.co-ppl-next .btn');
    await expect(action).toHaveText('Откликнуться на вакансию');
    await expect(action).not.toHaveClass(/is-primary/u);
    await expectNotCovered(page, '.co-ppl-next .btn');
    await action.click();
    await expect(page).toHaveURL(/\/app\/vacancies\/cluster-0$/u);
  });

  test('несколько вакансий — переход к «Вакансиям по вашим ролям» на этой же карточке', async ({
    page,
  }) => {
    await openWithoutPeople(page, 3);
    await expectNotCovered(page, '.co-ppl-next .btn');
    await page.locator('.co-ppl-next .btn').click();
    await expect(page.locator('#co-vac')).toBeFocused();
    await expect(page.locator('#co-vac')).toBeInViewport();
    await expect(page).toHaveURL(new RegExp(`${LIST_PATH}/${KEY}$`, 'u'));
  });

  test('вакансий нет — «Найти рекрутера» открывает «Контакты» по этой компании', async ({
    page,
  }) => {
    await openWithoutPeople(page, 0);
    const action = page.locator('.co-ppl-next .btn');
    await expect(action).toHaveText('Найти рекрутера');
    await expectNotCovered(page, '.co-ppl-next .btn');
    await page.route('**/api/v1/candidate/b640/contacts?*', (route) =>
      route.fulfill({
        json: {
          data: {
            items: [],
            total: 0,
            offset: 0,
            nextOffset: null,
            facets: {
              company: [],
              link: { direct: 0, intro: 0, none: 0 },
              status: { none: 0, written: 0, replied: 0 },
            },
            linkedinImport: {
              state: 'imported',
              importedAt: '2026-11-10T09:00:00.000Z',
              importedCount: 0,
            },
          },
        },
      }),
    );
    const request = page.waitForRequest('**/api/v1/candidate/b640/contacts?*');
    await action.click();
    expect(new URL((await request).url()).searchParams.getAll('company')).toEqual(['Ладога Банк']);
    await expect(page.locator('[data-b640-node="a02"]')).toBeVisible();
    // В компании никого — не пустой экран: строка и «Сбросить всё».
    await expect(page.locator('.vl-empty-t')).toHaveText('Никого не нашли');
    await expect(page.locator('.vl-empty .btn')).toHaveText('Сбросить всё');
  });
});
