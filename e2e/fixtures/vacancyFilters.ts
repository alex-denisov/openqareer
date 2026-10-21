import { expect, type Page } from '@playwright/test';

export type VacancyFilterGroupId = 'roles' | 'locations' | 'salary' | 'format' | 'sources';

/** B547: на 390 фильтры — лист со строками групп и push-экранами; на 1440 — поповер группы. */
export async function isMobileFilters(page: Page): Promise<boolean> {
  return page.evaluate(() => window.matchMedia('(max-width: 760px)').matches);
}

export async function openFilterGroup(page: Page, group: VacancyFilterGroupId): Promise<void> {
  const popover = page.locator('#vacancies-filter-popover');
  if (await isMobileFilters(page)) {
    const sheet = page.locator('.vacancies-mobile-sheet');
    if (!(await sheet.isVisible())) {
      await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    }
    const view = await sheet.getAttribute('data-sheet-view');
    if (view === group) return;
    if (view !== 'overview') await page.getByRole('button', { name: 'Назад к фильтрам' }).click();
    await page.locator(`[data-filter-sheet-group="${group}"]`).click();
    await expect(sheet).toHaveAttribute('data-sheet-view', group);
    return;
  }
  if ((await popover.getAttribute('data-active-group')) === group && (await popover.isVisible()))
    return;
  await page.locator(`[data-filter-group="${group}"]`).click();
  await expect(popover).toHaveAttribute('data-active-group', group);
}

export async function applyFilters(page: Page): Promise<void> {
  if (await isMobileFilters(page)) {
    await page.locator('.vacancies-mobile-sheet-cta').click();
  } else {
    await page
      .locator('#vacancies-filter-popover')
      .getByRole('button', { name: 'Применить' })
      .click();
  }
  await expect(page.locator('#vacancies-filter-popover')).toBeHidden();
}
