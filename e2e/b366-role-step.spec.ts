import { test, expect } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import * as fs from 'node:fs';

test.describe('B366: Step «Роль» and career redirect', () => {
  test('clicking step «Роль» opens «Вакансии» with role filter in focus and captures after screenshots', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1440',
      'runs multi-viewport capture once from desktop-1440',
    );
    fs.mkdirSync('output/playwright/B366', { recursive: true });
    await mockSignedInCabinet(page);

    // 1440
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    const roleStepButton = page
      .locator('.career-path-desktop')
      .getByRole('button', { name: /^Роль\./ })
      .first();
    await roleStepButton.click();

    // Verify it opened Vacancies screen
    await expect(page.locator('.vacancies-screen')).toBeVisible();
    await expect(page.locator('.vacancies-content')).toBeVisible();

    // Verify role filter input is focused
    const roleInput = page.locator('.add-role-input');
    await expect(roleInput).toBeVisible();
    await expect(roleInput).toBeFocused();

    // Verify premises are visible inside the expanded filters panel
    await expect(page.locator('.vacancies-filters.is-expanded')).toBeVisible();
    await expect(page.locator('.career-route-premises')).toBeVisible();

    // Capture after screenshot at 1440
    await page.screenshot({ path: 'output/playwright/B366/role-step-after-1440.png' });

    // 1176
    await page.setViewportSize({ width: 1176, height: 800 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'output/playwright/B366/role-step-after-1176.png' });

    // 390
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    // Click step «Роль» on mobile via mobile summary or role button
    const mobileRole = page.locator('.career-path-mobile-role');
    if (await mobileRole.isVisible()) {
      await mobileRole.click();
    } else {
      const mobileSummary = page.locator('.career-path-mobile-summary');
      if (await mobileSummary.isVisible()) {
        await mobileSummary.click();
      }
    }

    await expect(page.locator('.vacancies-screen')).toBeVisible();
    await expect(page.locator('.add-role-input')).toBeFocused();
    await page.screenshot({ path: 'output/playwright/B366/role-step-after-390.png' });
  });

  test('direct navigation to career redirects to opportunities', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'desktop only');
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    const roleStepButton = page
      .locator('.career-path-desktop')
      .getByRole('button', { name: /^Роль\./ })
      .first();
    await roleStepButton.click();

    await expect(page.locator('.vacancies-screen')).toBeVisible();
    // SearchCampaign / .career-campaign should not exist in the DOM
    await expect(page.locator('.career-campaign')).toHaveCount(0);
  });
});
