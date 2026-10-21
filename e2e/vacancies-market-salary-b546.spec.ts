import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

async function openVacancies(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.click();
  await expect(page.locator('.vac-list-item').first()).toBeVisible({ timeout: 15_000 });
}

const shownCount = (page: Page) =>
  page.locator('.vacancy-facet-count').first().innerText().then(Number);

test('B546: rows without salary show the market estimate or «мало данных»', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-390';
  await mockSignedInCabinet(page);
  await openVacancies(page);

  const estimate = page.locator('.vacancies-screen-cell--salary', { hasText: '≈ 480–560 тыс. ₽' });
  await expect(estimate.first()).toBeVisible();
  if (mobile) {
    await expect(estimate.first().locator('.vacancy-screen-money-short')).toHaveText('оценка');
    await expect(
      page.locator('.vacancy-screen-money-narrow', { hasText: 'без зарплаты' }).first(),
    ).toBeVisible();
    return;
  }
  await expect(estimate.first()).toContainText('оценка рынка');
  await expect(estimate.first()).toContainText('по 41 вакансии, 05.10');
  const thin = page.locator('.vacancies-screen-cell--salary', { hasText: 'мало данных' }).first();
  await expect(thin).toContainText('нет зарплаты, оценка по 3 вакансиям, 05.10');
  await expect(thin).not.toContainText('≈');
});

test('B546: salary toggles change the number of shown vacancies', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390', 'the salary popover is a desktop control');
  await mockSignedInCabinet(page);
  await openVacancies(page);
  const all = await shownCount(page);

  await page.locator('[data-filter-group="salary"]').click();
  const popover = page.locator('.vacancies-filters[data-active-group="salary"]');
  await expect(popover).toBeVisible();
  await popover.getByLabel('От', { exact: true }).fill('450000');

  await expect.poll(() => shownCount(page)).toBeLessThan(all);
  const statedOnly = await shownCount(page);

  await popover.getByLabel('Оценка рынка для вакансий без зарплаты').check();
  await expect.poll(() => shownCount(page)).toBeGreaterThan(statedOnly);
  await expect(popover).toContainText('Вакансии без зарплаты сравниваются по оценке рынка.');
  const withEstimate = await shownCount(page);

  await popover.getByLabel('Показывать вакансии без зарплаты').check();
  await expect.poll(() => shownCount(page)).toBeGreaterThan(withEstimate);

  await expect(page.locator('[data-filter-group="salary"]')).toContainText('от 450 тыс. ₽');
});
