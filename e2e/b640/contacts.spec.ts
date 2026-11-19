import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const PATH = '/app/profile/contacts';
const TOTAL = 1500;
const PAGE = 20;

const PEOPLE: ReadonlyArray<readonly [string, string, string, string, string, string]> = [
  [
    'Анна Ветрова',
    'руководитель найма',
    'Гринкод',
    'знакомы через Игоря Шаталова',
    'intro',
    'none',
  ],
  ['Павел Ким', 'CTO', 'Гринкод', 'ответил на ваш комментарий 10.11', 'direct', 'replied'],
  ['Елена Сафина', 'HR-партнёр', 'Гринкод', 'общих знакомых нет', 'none', 'none'],
  ['Игорь Нестеров', 'руководитель платформы', 'Гринкод', 'общих знакомых нет', 'none', 'none'],
  [
    'Дмитрий Лаптев',
    'технический рекрутер',
    'Вектор Банк',
    'работали вместе в «Сфере Платежи», 2018–2021',
    'direct',
    'written',
  ],
  [
    'Ксения Орлова',
    'руководитель направления разработки',
    'Вектор Банк',
    'общих знакомых нет',
    'none',
    'none',
  ],
  ['Сергей Белов', 'CTO', 'Арка Холдинг', 'знакомы через Игоря Шаталова', 'intro', 'none'],
  ['Ольга Миронова', 'руководитель найма', 'Арка Холдинг', 'общих знакомых нет', 'none', 'none'],
  [
    'Роман Ефимов',
    'руководитель группы платежей',
    'Ладога Банк',
    'работали вместе в «Сфере Платежи», 2018–2021',
    'direct',
    'none',
  ],
  ['Алина Громова', 'технический рекрутер', 'Ладога Банк', 'общих знакомых нет', 'none', 'none'],
  ['Елена Кравец', 'партнёр по подбору', 'Маркет Софт', 'общих знакомых нет', 'none', 'none'],
  ['Андрей Соболев', 'CTO', 'Маркет Софт', 'общих знакомых нет', 'none', 'none'],
  [
    'Максим Орехов',
    'руководитель направления',
    'Т-Технологии',
    'знакомы через Дмитрия Лаптева',
    'intro',
    'none',
  ],
  ['Виктория Ланская', 'рекрутер', 'Т-Технологии', 'общих знакомых нет', 'none', 'written'],
  [
    'Кирилл Зуев',
    'руководитель разработки',
    'Сбыт Онлайн',
    'общих знакомых нет',
    'none',
    'replied',
  ],
  ['Наталья Дубова', 'HR-директор', 'Карго Тех', 'общих знакомых нет', 'none', 'none'],
  [
    'Мария Ершова',
    'технический рекрутер',
    'Гринатом',
    'знакомы через Игоря Шаталова',
    'intro',
    'none',
  ],
  ['Олег Сафронов', 'руководитель найма', 'Гринатом', 'общих знакомых нет', 'none', 'none'],
  ['Тимур Алиев', 'CTO', 'Грин Лаб', 'общих знакомых нет', 'none', 'none'],
  ['Светлана Ковалёва', 'рекрутер', 'Медиа Плюс', 'общих знакомых нет', 'none', 'none'],
];

interface Item {
  id: string;
  fullName: string;
  roleTitle: string;
  companyName: string;
  link: string;
  linkNote: string | null;
  status: { state: string; at: string | null };
  inSelection: boolean;
}

const item = (index: number, states: Map<string, Item['status']>): Item => {
  const [fullName, roleTitle, companyName, linkNote, link, state] = PEOPLE[index % PEOPLE.length]!;
  const id = `c${index}`;
  const status = states.get(id) ?? {
    state,
    at:
      state === 'none'
        ? null
        : fullName === 'Виктория Ланская'
          ? '2026-11-05T09:00:00.000Z'
          : '2026-11-10T09:00:00.000Z',
  };
  return {
    id,
    fullName,
    roleTitle,
    companyName,
    link,
    linkNote,
    status,
    inSelection: index % 5 < 3,
  };
};

type Mode = 'list' | 'empty' | 'error' | 'flaky';

const FACETS = {
  companies: [
    { name: 'Гринкод', count: 900 },
    { name: 'Вектор Банк', count: 300 },
    { name: 'Арка Холдинг', count: 300 },
  ],
  link: { direct: 600, intro: 600, none: 300 },
  status: { none: 1300, written: 100, replied: 100 },
};

async function mockContacts(page: Page, mode: Mode) {
  await mockSignedInCabinet(page, { cabinetB640: true });
  const states = new Map<string, Item['status']>();
  const requests: string[] = [];
  const puts: Array<{ id: string; state: string }> = [];
  let failed = false;
  await page.route('**/api/v1/candidate/b640/contacts**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'PUT') {
      const id = decodeURIComponent(url.pathname.split('/').at(-2)!);
      const { state } = request.postDataJSON() as { state: string };
      puts.push({ id, state });
      const at = state === 'none' ? null : '2026-11-12T12:03:00.000Z';
      states.set(id, { state, at });
      return route.fulfill({ json: { data: { contactId: id, state, at } } });
    }
    requests.push(url.search);
    if (mode === 'error' || (mode === 'flaky' && !failed)) {
      failed = true;
      return route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'x', retryable: false } },
      });
    }
    const q = url.searchParams;
    const search = (q.get('search') ?? '').toLowerCase();
    const companies = q.getAll('company');
    const offset = Number(q.get('offset') ?? 0);
    const filtered =
      mode === 'empty' || search === 'нет такого' || q.getAll('status').includes('written')
        ? 0
        : companies.length > 0
          ? 300
          : TOTAL;
    const items = Array.from({ length: Math.max(0, Math.min(PAGE, filtered - offset)) }, (_, i) =>
      item(offset + i, states),
    ).map((entry) => (companies.length > 0 ? { ...entry, companyName: companies[0]! } : entry));
    return route.fulfill({
      json: {
        data: {
          items,
          total: filtered,
          offset,
          nextOffset: offset + PAGE < filtered ? offset + PAGE : null,
          facets: FACETS,
          linkedinImport: {
            state: 'imported',
            importedAt: '2026-11-10T09:00:00.000Z',
            importedCount: TOTAL,
          },
        },
      },
    });
  });
  return { requests, puts };
}

async function open(page: Page, mode: Mode) {
  const calls = await mockContacts(page, mode);
  await page.goto(PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="a02"]')).toBeVisible({ timeout: 15_000 });
  return calls;
}

test.describe('B697: «Контакты» нового кабинета (a02)', () => {
  test('список: заголовок, 20 строк, метки и «Показать ещё»', async ({ page }) => {
    await open(page, 'list');
    await expect(page.locator('#ct-title')).toHaveText(/1\s500 человек, которые нанимают/u);
    await expect(page.locator('li.ct-row')).toHaveCount(20);
    await expect(page.locator('li.ct-row .tag.ok').first()).toHaveText('ответил');
    await expect(page.locator('li.ct-row').first().locator('.ct-p')).toHaveText(
      'знакомы через Игоря Шаталова',
    );
    await page.getByRole('button', { name: /Показать ещё/ }).click();
    await expect(page.locator('li.ct-row')).toHaveCount(40);
    await expectGates(page);
  });

  test('поиск уходит на сервер, «ничего нет» сбрасывается', async ({ page }) => {
    const calls = await open(page, 'list');
    await page.locator('#ct-q').fill('нет такого');
    await expect(page.locator('.vl-empty-t')).toHaveText('Никого не нашли');
    expect(calls.requests.some((query) => query.includes('search=%D0%BD%D0%B5%D1%82'))).toBe(true);
    await page.locator('.vl-empty').getByRole('button', { name: 'Сбросить всё' }).click();
    await expect(page.locator('li.ct-row')).toHaveCount(20);
    await expect(page.locator('#ct-q')).toHaveValue('');
  });

  test('фильтр «Компания»: чип, запрос и сброс', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'поповер — на широких экранах');
    const calls = await open(page, 'list');
    await page.locator('.vt-fbtn', { hasText: 'Компания' }).click();
    await page
      .locator('#pop-company')
      .getByLabel(/Вектор Банк/u)
      .check();
    await expect(page.locator('.vt-chip')).toHaveText('Вектор Банк');
    await expect(page.locator('#ct-title')).toHaveText(/300 человек, которые нанимают/u);
    expect(
      calls.requests.some((query) =>
        query.includes('company=%D0%92%D0%B5%D0%BA%D1%82%D0%BE%D1%80'),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Сбросить всё' }).click();
    await expect(page.locator('.vt-chip')).toHaveCount(0);
    await expect(page.locator('#ct-title')).toHaveText(/1\s500 человек, которые нанимают/u);
  });

  test('390: «Фильтры» открывает лист', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'desktop-1440', 'лист — только на узких экранах');
    await open(page, 'list');
    await page.locator('.vt-mfilter').click();
    await expect(page.locator('#ct-sheet')).toContainText('Сортировка');
    await expect(page.locator('#ct-sheet')).toContainText('Связь');
    await page.getByRole('button', { name: 'Закрыть фильтры' }).click();
    await expectGates(page);
  });

  test('связей нет: одна строка пустого состояния', async ({ page }) => {
    await open(page, 'empty');
    await expect(page.locator('.vl-empty-t')).toHaveText('Связей пока нет');
    await expectGates(page);
  });

  test('ошибка загрузки с «Повторить»', async ({ page }) => {
    await open(page, 'flaky');
    await expect(page.getByRole('alert')).toContainText('Контакты не загрузились');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('li.ct-row')).toHaveCount(20);
  });

  test('снимки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    for (const [name, mode] of [
      ['contacts', 'list'],
      ['contacts-empty', 'empty'],
      ['contacts-error', 'error'],
    ] as const) {
      await mockContacts(page, mode);
      for (const theme of ['light', 'dark'] as const) {
        await page.goto(PATH, { waitUntil: 'domcontentloaded' });
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto(PATH, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-b640-node="a02"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
        if (mode === 'list') await expect(page.locator('li.ct-row')).toHaveCount(20);
        for (const width of desktop ? [1440, 1176] : [390]) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
    if (desktop) {
      await mockContacts(page, 'list');
      await page.goto(PATH, { waitUntil: 'domcontentloaded' });
      await page.locator('.vt-fbtn', { hasText: 'Компания' }).click();
      await page.screenshot({
        path: '.s13-shots/contacts-filter-company-1440-light.png',
        fullPage: true,
      });
    }
  });
});
