import { expect, type Page } from '@playwright/test';

/** Desktop opens tariffs from the rail wallet; 390 reaches them through the «Ещё» menu. */
export async function openTariffsFromShell(page: Page): Promise<void> {
  await expect(
    page.locator('.career-rail-wallet:visible, .career-mobile-nav:visible').first(),
  ).toBeVisible({ timeout: 20_000 });
  const mobile = (page.viewportSize()?.width ?? 1440) <= 760;
  if (!mobile) {
    await page.locator('.career-rail-wallet:visible').first().click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page.getByRole('menuitem', { name: 'Тарифы' }).click();
  }
  await expect(page.locator('.career-tariffs:visible')).toBeVisible();
}
