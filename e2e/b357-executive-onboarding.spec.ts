import { test, expect } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import * as fs from 'node:fs';

test.describe('B357: Executive Onboarding 30-60-90 Coach', () => {
  test.fixme(
    true,
    'ACC-A-1 removed this surface from the approved Today and nothing mounts it now; owner decision pending (restore or retire). Do not weaken: re-enable when the surface is back.',
  );
  test('renders executive onboarding card, supports tabs, checklist and captures 1440, 1000, 390', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1440',
      'runs multi-viewport capture once from desktop-1440',
    );

    fs.mkdirSync('output/playwright/B357', { recursive: true });
    await mockSignedInCabinet(page);

    // --- 1440px ---
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    const card = page.locator('[data-testid="executive-onboarding-card"]');
    await expect(card).toBeHidden();
    await page.screenshot({ path: 'output/playwright/B357/onboarding-1440.png' });

    // The approved 1440 Today screen no longer includes the onboarding block.
    // It remains available in the legacy compact Today layout, which is used below the 1024 px
    // line where the desktop composition of the mockups starts.
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(card).toBeVisible();

    // Check title and advice box
    await expect(card.locator('.career-onboarding-title')).toHaveText(
      'Executive-онбординг: 30-60-90 дней',
    );
    await expect(card.locator('[data-testid="coach-advice-box"]')).toBeVisible();

    // Click tab 60 дней
    const tab60 = card.locator('[data-testid="stage-tab-days-60"]');
    await tab60.click();
    await expect(tab60).toHaveAttribute('aria-selected', 'true');

    // Toggle a task checkbox
    const firstCheckbox = card.locator('input[type="checkbox"]').first();
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked();

    // Open and submit quantum form
    const toggleQuantumBtn = card.locator('[data-testid="toggle-quantum-form-btn"]');
    await toggleQuantumBtn.click();
    await expect(card.locator('[data-testid="quantum-form"]')).toBeVisible();

    await card.locator('#quantum-situation').fill('Реорганизация департамента платформы');
    await card.locator('#quantum-action').fill('Сформировал кросс-функциональные стримы');
    await card.locator('#quantum-result').fill('Time to market сократился на 35%');
    await card.locator('[data-testid="save-quantum-btn"]').click();

    await expect(card.locator('[data-testid="quantums-list"]')).toBeVisible();
    await expect(card.locator('[data-testid="quantums-list"]')).toContainText('Time to market');

    // Screenshot 1000px after exercising the retained component.
    await page.screenshot({ path: 'output/playwright/B357/onboarding-1000.png' });

    // --- 390px ---
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    const mobileCard = page.locator('[data-testid="executive-onboarding-card"]');
    await expect(mobileCard).toBeVisible();

    // Ensure no horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBe(false);

    await page.screenshot({ path: 'output/playwright/B357/onboarding-390.png' });
  });
});
