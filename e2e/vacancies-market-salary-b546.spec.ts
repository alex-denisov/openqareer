import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

async function openVacancies(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.click();
  await expect(page.locator('.vac-list-item').first()).toBeVisible({ timeout: 15_000 });
}

/** «Показано 20 из 34 с вашими условиями»: the filtered total of the desktop summary. */
async function shownCount(page: Page): Promise<number> {
  const copy = await page.locator('.vacancies-summary-copy').innerText();
  const match = /из\s+([\d\s\u00a0]+)\s+с вашими условиями/u.exec(copy);
  return Number((match?.[1] ?? '').replace(/\D/gu, ''));
}

test('B546: rows without salary show the market estimate or «мало данных»', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-390';
  await mockSignedInCabinet(page);
  await openVacancies(page);

  const estimate = page.locator('.vacancies-screen-cell--salary', { hasText: '≈ 480–560 тыс. ₽' });
  await expect(estimate.first()).toBeVisible();
  mkdirSync('output/playwright/B546', { recursive: true });
  await page.screenshot({
    path: `output/playwright/B546/vacancies-${mobile ? 390 : 1440}.png`,
    fullPage: true,
  });
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

  const salary = page.locator('[data-filter-group="salary"]');
  const popover = page.locator('.vacancies-filters[data-active-group="salary"]');
  const openSalary = async () => {
    if (!(await popover.isVisible())) await salary.click();
    await expect(popover).toBeVisible();
  };
  const apply = () => popover.getByRole('button', { name: 'Применить' }).click();

  await openSalary();
  await popover.getByLabel('От', { exact: true }).fill('450000');
  await apply();
  await expect.poll(() => shownCount(page)).toBeLessThan(all);
  const statedOnly = await shownCount(page);

  await openSalary();
  await popover.getByLabel('Оценка рынка для вакансий без зарплаты').check();
  await expect(popover).toContainText('Вакансии без зарплаты сравниваются по оценке рынка.');
  await apply();
  await expect.poll(() => shownCount(page)).toBeGreaterThan(statedOnly);
  const withEstimate = await shownCount(page);

  await openSalary();
  await popover.getByLabel('Показывать вакансии без зарплаты').check();
  await apply();
  await expect.poll(() => shownCount(page)).toBeGreaterThan(withEstimate);

  await expect(page.locator('[data-filter-group="salary"]')).toContainText('от 450 тыс. ₽');
});
