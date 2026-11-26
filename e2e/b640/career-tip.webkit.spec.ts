import { expect, test } from '@playwright/test';
import { openCareer, tipAloneLengths } from './careerFixture';

/**
 * s10 (B645-2, 24.11): в .app (системный WebKit) с длинным заголовком «Как посчитано»
 * уходило отдельной строкой под него. Значок держится за последнее слово.
 */
test.use({ browserName: 'webkit' });

for (const width of [1440, 390]) {
  test(`S10 ${width}: «Как посчитано» на строке последнего слова заголовка`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openCareer(page, '/app/career', { status: 'choosing_role', searchRoles: [] });
    const head = page.locator('[data-b640-state="s10"] .lead-head').first();
    await expect(head.locator('.lead-title')).toBeVisible();
    expect(await tipAloneLengths(head)).toEqual([]);
  });
}
