import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';
import type { MatchedVacancyFacets } from '../shared/matchedVacancyFacets';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

function source(
  id: string,
  name: string,
  market: string,
  category: string,
  attributionUrl: string,
) {
  return {
    id,
    name,
    market,
    category,
    transport: 'public_api',
    searchCoverage: `Тестовые вакансии по рынку ${market}`,
    attributionUrl,
    documentationUrl: attributionUrl,
    reviewedAt: '2026-10-14',
    health: {
      status: 'healthy',
      lastAttemptAt: '2026-10-14T08:00:00.000Z',
      lastSuccessAt: '2026-10-14T08:00:00.000Z',
      lastErrorCode: null,
      retryAfterAt: null,
      consecutiveFailures: 0,
    },
  };
}

const sourceCatalog = [
  source(
    'greenhouse',
    'Greenhouse',
    'США и Канада',
    'ATS компаний',
    'https://boards.greenhouse.io/',
  ),
  source('hh', 'hh.ru', 'Россия и СНГ', 'Агрегаторы и API', 'https://hh.ru/'),
  source(
    'remotive',
    'Remotive',
    'Международный remote',
    'Международные площадки',
    'https://remotive.com/',
  ),
  source(
    'tg-product',
    'Telegram @product_jobs',
    'Product & Management',
    'Telegram каналы',
    'https://t.me/product_jobs',
  ),
  ...Array.from({ length: 20 }, (_, index) => {
    const categories = [
      'ATS компаний',
      'Агрегаторы и API',
      'Международные площадки',
      'Telegram каналы',
    ];
    const category = categories[index % categories.length]!;
    return source(
      `fixture-${index + 1}`,
      `Источник ${index + 1}`,
      `Рынок ${index + 1}`,
      category,
      `https://source-${index + 1}.example/`,
    );
  }),
];

const vacancyFacets: MatchedVacancyFacets = {
  total: 5,
  regions: [],
  remote: 2,
  levels: [],
  roles: [],
  sources: [
    { sourceId: 'greenhouse', name: 'Greenhouse', count: 2 },
    { sourceId: 'hh', name: 'hh.ru', count: 3 },
    { sourceId: 'remotive', name: 'Remotive', count: 1 },
  ],
  sourceGroups: [
    { id: 'platforms', name: 'Площадки', count: 1 },
    { id: 'ats', name: 'ATS компаний', count: 2 },
    { id: 'aggregators', name: 'Агрегаторы', count: 3 },
    { id: 'channels', name: 'Каналы', count: 0 },
  ],
};

function trackMatchedSourceQueries(page: import('@playwright/test').Page): string[][] {
  const queries: string[][] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/candidate/matched-vacancies' && request.method() === 'GET') {
      queries.push(url.searchParams.getAll('source'));
    }
  });
  return queries;
}

async function captureEvidence(page: import('@playwright/test').Page, name: string): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport не определён.');
  const prefix = String(viewport.width) + 'x' + String(viewport.height);
  const directory = 'test-results/evidence/AUD-4';
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, prefix + '-' + name + '.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const port = process.env.E2E_PORT ?? '4173';
  const html = (await page.content())
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/(href|src)="\/assets\//gu, '$1="http://127.0.0.1:' + port + '/assets/');
  await writeFile(join(directory, prefix + '-' + name + '.html'), html);
}

async function exerciseSourceCatalogControls(
  sourceFilter: import('@playwright/test').Locator,
): Promise<void> {
  const showMore = sourceFilter.getByRole('button', { name: 'Показать ещё 20', exact: true });
  await expect(showMore).toBeVisible();
  await showMore.click();
  await expect(sourceFilter.getByRole('button', { name: /Источник 20/u })).toBeVisible();
  await sourceFilter.getByRole('button', { name: 'Все 24', exact: true }).click();
  await expect(sourceFilter.getByText(/Выбрано 24/u)).toBeVisible();
  await sourceFilter.getByRole('button', { name: 'Снять все', exact: true }).click();
  await expect(sourceFilter.getByText(/Выбрано 0/u)).toBeVisible();
}

async function openVacancies(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
  await expect(page.locator('.vac-list-item').first()).toBeVisible();
}

async function openSourceFilter(
  page: import('@playwright/test').Page,
  mobile: boolean,
): Promise<void> {
  if (mobile) {
    await page.getByRole('button', { name: /^Фильтры/u }).click();
  } else {
    await page.locator('[data-filter-group="sources"]').click();
  }
  await expect(page.locator('.vacancies-filters')).toBeVisible();
  await expect(page.locator('.vacancy-source-filter')).toBeVisible();
}

test.describe('AUD-4 — экран вакансий', () => {
  test('B447: searches the full source catalog and applies or clears multiple sources', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-390';
    await mockSignedInCabinet(page, { vacancyTotal: 5, vacancyFacets });
    await page.route('**/api/v1/candidate/vacancy-sources', (route) =>
      route.fulfill({ json: { data: sourceCatalog } }),
    );
    const sourceQueries = trackMatchedSourceQueries(page);
    await openVacancies(page);
    await openSourceFilter(page, mobile);

    const sourceFilter = page.locator('.vacancy-source-filter');
    const categoryGroup = sourceFilter.getByRole('group', { name: 'Категории источников' });
    await expect(categoryGroup.getByRole('button')).toContainText([
      /Все источники/u,
      /Площадки/u,
      /ATS компаний/u,
      /Агрегаторы/u,
      /Каналы/u,
    ]);
    await exerciseSourceCatalogControls(sourceFilter);

    const search = sourceFilter.getByRole('searchbox', { name: /Найти среди/u });
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('placeholder', 'Найти по названию, домену или стране');
    await categoryGroup.getByRole('button', { name: /ATS компаний/u }).click();
    await search.fill('boards.greenhouse.io');
    const greenhouse = sourceFilter.getByRole('button', { name: /Greenhouse/u });
    await expect(greenhouse).toBeVisible();
    await expect(sourceFilter.getByRole('button', { name: /hh\.ru/u })).toHaveCount(0);
    await greenhouse.click();
    await captureEvidence(page, 'source-search');

    await categoryGroup.getByRole('button', { name: /Агрегаторы/u }).click();
    await search.fill('россия');
    const hh = sourceFilter.getByRole('button', { name: /hh\.ru/u });
    await expect(hh).toBeVisible();
    await hh.click();
    await expect(sourceFilter.getByText(/Выбрано 2/u)).toBeVisible();

    const applyName = mobile ? 'Показать результаты' : 'Применить';
    await page.getByRole('button', { name: applyName, exact: true }).click();
    await expect
      .poll(() =>
        sourceQueries.some((query) => query.includes('greenhouse') && query.includes('hh')),
      )
      .toBe(true);

    const beforeClear = sourceQueries.length;
    await openSourceFilter(page, mobile);
    await sourceFilter.getByRole('button', { name: 'Снять все', exact: true }).click();
    await expect(sourceFilter.getByText(/Выбрано 0/u)).toBeVisible();
    await page.getByRole('button', { name: applyName, exact: true }).click();
    await expect.poll(() => sourceQueries.length).toBeGreaterThan(beforeClear);
    expect(sourceQueries.at(-1)).toEqual([]);
  });

  test('loads another 20 vacancies only when results remain', async ({ page }) => {
    await mockSignedInCabinet(page, { vacancyTotal: 25 });
    await openVacancies(page);
    const rows = page.locator('.vac-list-item');
    await expect(rows).toHaveCount(20);
    const loadMore = page.getByRole('button', { name: 'Показать ещё 20', exact: true });
    await expect(loadMore).toBeVisible();
    await loadMore.click();
    await expect(rows).toHaveCount(25);
    await expect(loadMore).toHaveCount(0);
  });

  test('one vacancy is a normal single row with no fabricated pagination', async ({ page }) => {
    await mockSignedInCabinet(page, { vacancyTotal: 1 });
    await openVacancies(page);
    await expect(page.locator('.vac-list-item')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Показать ещё 20', exact: true })).toHaveCount(0);
  });

  test('reports a degraded source without inventing its stale vacancy count', async ({ page }) => {
    const sourceCatalogWithFailure = sourceCatalog.map((item) =>
      item.id === 'remotive'
        ? {
            ...item,
            health: {
              ...item.health,
              status: 'degraded',
              lastSuccessAt: '2026-10-04T08:00:00.000Z',
              consecutiveFailures: 2,
            },
          }
        : item,
    );
    await mockSignedInCabinet(page, { vacancyTotal: 5, vacancyFacets });
    await page.route('**/api/v1/candidate/vacancy-sources', (route) =>
      route.fulfill({ json: { data: sourceCatalogWithFailure } }),
    );
    await openVacancies(page);

    const notice = page
      .getByRole('status')
      .filter({ hasText: 'Некоторые источники недоступны или отвечают с ошибками' });
    await expect(notice).toContainText('Remotive');
    await expect(notice).toContainText('Объём затронутых вакансий не определён.');
    await expect(notice).not.toContainText('416');
    await captureEvidence(page, 'partial-source');
  });
});
