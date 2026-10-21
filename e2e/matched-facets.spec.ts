import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockMatchedFacets } from './fixtures/matchedFacets';
import { applyFilters, openFilterGroup } from './fixtures/vacancyFilters';
import { captureCareerHarness } from './helpers/capture-career-harness';
import { waitForCareerShell } from './helpers/waitForCareerShell';

async function expectMatchedCount(page: Page, count: string) {
  await expect(page.locator('.list-hint[aria-live="polite"]')).toHaveAttribute('aria-label', count);
}

/** B547: «Формат» — чипы; «Источники» — чекбоксы каталога (макет 4). */
async function toggleRemoteOnly(page: Page) {
  await openFilterGroup(page, 'format');
  await page
    .locator('.vacancy-format-filter')
    .getByRole('button', { name: /Удалённо/u })
    .click();
  await applyFilters(page);
}

async function toggleSource(page: Page, name: string) {
  await openFilterGroup(page, 'sources');
  await page.locator('.vacancy-source-filter').getByRole('checkbox', { name }).click();
  await applyFilters(page);
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

  await toggleRemoteOnly(page);
  await expectMatchedCount(page, 'Показано 1 из 3');
  expect(reads.at(-1)?.searchParams.get('remote')).toBe('1');
  expect(reads.at(-1)?.searchParams.get('offset') ?? '0').toBe('0');
  await toggleRemoteOnly(page);
  await expectMatchedCount(page, 'Показано 3 из 3');

  await toggleSource(page, 'Remotive');
  await expectMatchedCount(page, 'Показано 1 из 3');
  expect(reads.at(-1)?.searchParams.getAll('source')).toEqual(['remotive']);
  await toggleSource(page, 'Remotive');
  await expectMatchedCount(page, 'Показано 3 из 3');

  // Роли кампании — чекбоксы; уровень в поповере не выбирается (макет 4).
  await openFilterGroup(page, 'roles');
  await expect(
    page.getByTestId('role-tree-filter').getByRole('checkbox', { name: 'Enterprise Architect' }),
  ).toBeChecked();
  await expect(page.locator('.vacancies-level-filter')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Сохранённые/u })).toBeVisible();
  expect(errors).toEqual([]);
});

test('B338: фильтры читаемы на 1440, 1176, 390 и не переполняют 280', async ({
  page,
}, testInfo) => {
  await mockMatchedFacets(page);
  mkdirSync('output/playwright/B338', { recursive: true });
  for (const width of [1440, 1176, 390, 280]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await openVacancies(page);
    await openFilterGroup(page, 'sources');
    const rows = page.locator('.vacancy-source-filter .vacancy-location-row');
    await expect(rows.first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `output/playwright/B338/${testInfo.project.name}-${width}.png`,
      fullPage: true,
    });
    if (width === 1440) await captureCareerHarness(page, 'output/playwright/B338/facets.html');
  }
});
