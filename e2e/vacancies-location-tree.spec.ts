import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { matchedVacancyPage } from './fixtures/readabilityWorkspace';

// B547: «Локации» — дерево страна › регион › город по выдаче, макет 4 (pop=geo).
const PLACES: readonly (readonly [string, boolean])[] = [
  ['Москва', false],
  ['Москва', false],
  ['Москва', false],
  ['Тверь', false],
  ['Тула', false],
  ['Санкт-Петербург', false],
  ['New York, NY, United States', false],
  ['New York, NY, United States', false],
  ['Jersey City, New Jersey, United States', false],
  ['New Orleans, LA, United States', false],
  ['San Francisco, CA, United States', false],
  ['Remote', true],
];

async function mockLocationPool(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { vacancyTotal: PLACES.length });
  const base = matchedVacancyPage(0, PLACES.length);
  const data = base.data.map((item, index) => ({
    ...item,
    cluster: {
      ...item.cluster,
      canonicalTitle: `Head of Engineering ${index + 1}`,
      canonicalLocation: PLACES[index]![0],
      isRemote: PLACES[index]![1],
    },
  }));
  await page.route('**/api/v1/candidate/matched-vacancies**', (route) =>
    route.fulfill({ json: { ...base, data } }),
  );
}

async function openLocations(page: Page, mobile: boolean): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await expect(page.locator('.vac-list-item').first()).toBeVisible({ timeout: 15_000 });
  if (mobile) {
    // 390: лист фильтров — строки групп; «Локации» открывает push-экран с деревом.
    await page.getByRole('button', { name: 'Фильтры' }).click();
    await page.locator('[data-filter-sheet-group="locations"]').click();
  } else {
    await page.locator('[data-filter-group="locations"]').click();
  }
  await expect(page.getByTestId('location-tree-filter')).toBeVisible();
}

function summary(page: Page) {
  return page.locator('.vacancies-search-summary');
}

const tree = (page: Page) => page.getByTestId('location-tree-filter');

test('B547: federal district changes the list, Cancel keeps it', async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-390';
  await mockLocationPool(page);
  await openLocations(page, mobile);
  const width = mobile ? '390' : '1440';
  mkdirSync('output/playwright/B547', { recursive: true });
  await page.screenshot({ path: `output/playwright/B547/geo-${width}.png`, fullPage: true });

  if (!mobile) {
    await tree(page).getByRole('checkbox', { name: 'Центральный ФО' }).check();
    await expect(tree(page).getByRole('checkbox', { name: 'Москва' })).toBeChecked();
    await tree(page).getByRole('button', { name: 'Отмена' }).click();
    await expect(summary(page)).toContainText('из 12');
    await page.locator('[data-filter-group="locations"]').click();
  }
  await tree(page).getByRole('checkbox', { name: 'Центральный ФО' }).check();
  await expect(tree(page).getByRole('checkbox', { name: 'Москва' })).toBeChecked();
  if (mobile) await page.locator('.vacancies-mobile-sheet-cta').click();
  else await tree(page).getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('.vac-list-item')).toHaveCount(5);
  await expect(page.locator('.vac-list')).not.toContainText('Head of Engineering 6');
});

test('B547: search shows four hits with path, other countries need relocation', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-390';
  await mockLocationPool(page);
  await openLocations(page, mobile);
  const width = mobile ? '390' : '1440';

  await expect(tree(page).getByRole('checkbox', { name: 'США' })).toBeDisabled();
  await tree(page).getByRole('button', { name: 'Развернуть США' }).click();
  await tree(page).getByRole('button', { name: 'Включить' }).click();
  await expect(tree(page).getByRole('checkbox', { name: 'США' })).toBeEnabled();
  await page.screenshot({ path: `output/playwright/B547/geo2-${width}.png`, fullPage: true });

  await tree(page).getByRole('searchbox', { name: 'Страна, регион, штат или город' }).fill('нью');
  const hits = tree(page).locator('.vacancy-location-hit');
  await expect(hits).toHaveCount(4);
  await expect(hits.first()).toContainText('США › штат Нью-Йорк');
  await expect(tree(page)).toContainText('Найдено 4 по «нью»');
  await page.screenshot({ path: `output/playwright/B547/geosearch-${width}.png`, fullPage: true });
});
