import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockMatchedFacets } from './fixtures/matchedFacets';
import { captureCareerHarness } from './helpers/capture-career-harness';

async function openFilters(page: Page) {
  if (!(await page.locator('.filters-panel.is-expanded').isVisible())) {
    await page.getByRole('button', { name: 'Фильтры и сохранённые запросы' }).click();
  }
  return page.locator('.vacancies-filters');
}

async function openVacancies(page: Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);
  await page
    .getByRole('button', { name: 'Вакансии', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.getByText('Показано 3 из 3', { exact: true })).toBeVisible();
}

test('B338: фильтр перечитывает подборку, сохраняя числа всей выдачи', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const reads = await mockMatchedFacets(page);
  await openVacancies(page);
  const filters = await openFilters(page);
  await expect(filters.getByText(/Добавить:/)).toHaveCount(0);
  const us = filters.getByRole('button', { name: /US.*2/ });
  await expect(us).toHaveAttribute('aria-pressed', 'false');
  await us.click();
  await expect(page.getByText('Показано 2 из 3', { exact: true })).toBeVisible();
  expect(reads.at(-1)?.searchParams.getAll('region')).toEqual(['us']);
  expect(reads.at(-1)?.searchParams.get('offset') ?? '0').toBe('0');
  await expect(us).toHaveAttribute('aria-pressed', 'true');
  await filters.getByRole('button', { name: /Удалённо.*1/ }).click();
  await expect(page.getByText('Показано 1 из 3', { exact: true })).toBeVisible();
  expect(reads.at(-1)?.searchParams.get('remote')).toBe('1');
  await us.click();
  await filters.getByRole('button', { name: /Удалённо.*1/ }).click();
  await expect(page.getByText('Показано 3 из 3', { exact: true })).toBeVisible();
  await filters.getByRole('button', { name: /Руководитель.*2/ }).click();
  await expect(page.getByText('Показано 2 из 3', { exact: true })).toBeVisible();
  expect(reads.at(-1)?.searchParams.getAll('level')).toEqual(['head']);
  await filters.getByRole('button', { name: /Remotive.*1/ }).click();
  await expect(page.getByText('Показано 0 из 3', { exact: true })).toBeVisible();
  expect(reads.at(-1)?.searchParams.getAll('source')).toEqual(['remotive']);
  await filters.getByRole('button', { name: /Руководитель.*2/ }).click();
  await expect(page.getByText('Показано 1 из 3', { exact: true })).toBeVisible();
  await filters.getByRole('button', { name: /Remotive.*1/ }).click();
  await expect(page.getByText('Показано 3 из 3', { exact: true })).toBeVisible();
  await filters.getByRole('button', { name: /Enterprise Architect.*3/ }).click();
  await expect
    .poll(() => reads.at(-1)?.searchParams.getAll('role'))
    .toEqual(['Enterprise Architect']);
  await page.getByRole('button', { name: /Сохранённые поиски/ }).click();
  await expect(page.getByRole('region', { name: 'Сохранённые запросы' })).toBeVisible();
  await expect(page.getByText('Показано 3 из 3', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('B338: фильтры читаемы на 1440, 1176, 390 и не переполняют 280', async ({
  page,
}, testInfo) => {
  await mockMatchedFacets(page);
  await openVacancies(page);
  mkdirSync('output/playwright/B338', { recursive: true });
  for (const width of [1440, 1176, 390, 280]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    const filters = await openFilters(page);
    await expect(filters.getByRole('button', { name: /US.*2/ })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    const chips = filters.getByRole('button').filter({ has: page.locator('.vacancy-facet-count') });
    expect(await chips.count()).toBeGreaterThan(0);
    for (const chip of await chips.all()) {
      const box = await chip.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `output/playwright/B338/${testInfo.project.name}-${width}.png`,
      fullPage: true,
    });
    if (width === 1440) await captureCareerHarness(page, 'output/playwright/B338/facets.html');
  }
});
