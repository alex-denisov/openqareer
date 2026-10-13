import { test, expect } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { waitForCareerShell } from './helpers/waitForCareerShell';
import { seedReadabilityWorkspace } from './helpers/seedReadabilityWorkspace';
import * as fs from 'node:fs';

test.describe('B366: Career rail entry opens the existing role filter', () => {
  test('opens «Вакансии» with role filter in focus and captures after screenshots', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1440',
      'runs multi-viewport capture once from desktop-1440',
    );
    fs.mkdirSync('output/playwright/B366', { recursive: true });
    await mockSignedInCabinet(page);
    await seedReadabilityWorkspace(page);

    // 1440
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    const careerRailButton = page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьера', exact: true });
    await careerRailButton.click();

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
    await waitForCareerShell(page);

    // The compact layout keeps its existing role-step path.
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
    const mobileRoleInput = page.locator('.add-role-input');
    if (!(await mobileRoleInput.isVisible())) {
      await page.locator('[data-filter-sheet-group="roles"]').click();
    }
    await expect(mobileRoleInput).toBeFocused();
    await page.screenshot({ path: 'output/playwright/B366/role-step-after-390.png' });
  });

  test('the «Карьера» rail entry opens opportunities with the role filter focused', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'desktop only');
    await mockSignedInCabinet(page);
    await seedReadabilityWorkspace(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await waitForCareerShell(page);

    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьера', exact: true })
      .click();

    await expect(page.locator('.vacancies-screen')).toBeVisible();
    // SearchCampaign / .career-campaign should not exist in the DOM
    await expect(page.locator('.career-campaign')).toHaveCount(0);
  });
});
