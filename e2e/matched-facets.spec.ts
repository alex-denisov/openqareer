import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockMatchedFacets } from './fixtures/matchedFacets';
import { captureCareerHarness } from './helpers/capture-career-harness';
import { waitForCareerShell } from './helpers/waitForCareerShell';

async function openFilters(page: Page) {
  const mobile = await page.evaluate(() => window.matchMedia('(max-width: 760px)').matches);
  if (mobile) {
    if (!(await page.locator('.vacancies-filters.is-mobile-open').isVisible())) {
      await page.locator('.vacancies-mobile-filter-toggle').click();
    }
    const locationsHeading = page
      .locator('.vacancies-filters')
      .getByRole('heading', { name: 'Локации', exact: true })
      .first();
    if (!(await locationsHeading.isVisible())) {
      await page.locator('[data-filter-sheet-group="locations"]').click();
    }
  } else if (!(await page.locator('.filters-panel.is-expanded').isVisible())) {
    await page.locator('[data-filter-group="locations"]').click();
  }
  return page.locator('.vacancies-filters');
}

async function openFilterGroup(page: Page, groupId: string) {
  const mobile = await page.evaluate(() => window.matchMedia('(max-width: 760px)').matches);
  if (mobile) {
    if (!(await page.locator('.vacancies-filters.is-mobile-open').isVisible())) {
      await page.locator('.vacancies-mobile-filter-toggle').click();
    }
    return;
  }
  const group = page.locator(`[data-filter-group="${groupId}"]`);
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
}

async function applyFilterDraft(page: Page) {
  const name = await page.evaluate(() =>
    window.matchMedia('(max-width: 760px)').matches ? 'Показать результаты' : 'Применить',
  );
  await page.getByRole('button', { name, exact: true }).click();
}

async function expectMatchedCount(page: Page, count: string) {
  await expect(page.locator('.list-hint[aria-live="polite"]')).toHaveAttribute('aria-label', count);
}

async function applyFacet(
  page: Page,
  filters: Locator,
  group: string,
  label: RegExp,
  count?: string,
) {
  await openFilterGroup(page, group);
  if (group === 'roles') {
    const levels = filters.locator('.vacancies-level-filter');
    if ((await levels.getAttribute('open')) === null) await levels.locator('summary').click();
  }
  await filters.getByRole('button', { name: label }).click();
  await applyFilterDraft(page);
  if (count) await expectMatchedCount(page, count);
}

async function applyRemoteOnlyFacet(page: Page, filters: Locator, count: string) {
  await openFilterGroup(page, 'format');
  await filters
    .locator('.field-group')
    .filter({ has: page.getByRole('heading', { name: 'Формат работы', exact: true }) })
    .getByRole('button', { name: /Удалённо/u })
    .click();
  await applyFilterDraft(page);
  await expectMatchedCount(page, count);
}

async function openVacancies(page: Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await waitForCareerShell(page);
  await page
    .getByRole('button', { name: 'Вакансии', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page.locator('.list-hint[aria-live="polite"]')).toHaveAttribute(
    'aria-label',
    'Показано 3 из 3',
  );
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
  await applyFilterDraft(page);
  await expectMatchedCount(page, 'Показано 2 из 3');
  expect(reads.at(-1)?.searchParams.getAll('region')).toEqual(['us']);
  expect(reads.at(-1)?.searchParams.get('offset') ?? '0').toBe('0');
  await openFilterGroup(page, 'locations');
  await expect(us).toHaveAttribute('aria-pressed', 'true');

  await applyRemoteOnlyFacet(page, filters, 'Показано 1 из 3');
  expect(reads.at(-1)?.searchParams.get('remote')).toBe('1');
  await openFilterGroup(page, 'locations');
  await us.click();
  await applyFilterDraft(page);
  await applyRemoteOnlyFacet(page, filters, 'Показано 3 из 3');

  await applyFacet(page, filters, 'roles', /Руководитель.*2/, 'Показано 2 из 3');
  expect(reads.at(-1)?.searchParams.getAll('level')).toEqual(['head']);
  await applyFacet(page, filters, 'sources', /Remotive.*1/, 'Показано 0 из 3');
  expect(reads.at(-1)?.searchParams.getAll('source')).toEqual(['remotive']);

  await applyFacet(page, filters, 'roles', /Руководитель.*2/, 'Показано 1 из 3');
  await applyFacet(page, filters, 'sources', /Remotive.*1/, 'Показано 3 из 3');
  await applyFacet(page, filters, 'roles', /Enterprise Architect.*3/);
  await expect
    .poll(() => reads.at(-1)?.searchParams.getAll('role'))
    .toEqual(['Enterprise Architect']);
  await expect(page.locator('.filters-bar .saved-btn')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Сохранённые/u })).toBeVisible();
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
