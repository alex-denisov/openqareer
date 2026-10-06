import * as fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

test.describe('B384: Candidate Decision Profile', () => {
  test.beforeAll(() => {
    fs.mkdirSync('output/playwright/B384', { recursive: true });
  });

  test('configures decision profile in side rail and verifies confidentiality and persistence (desktop-1440)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'Desktop-only test');

    await mockSignedInCabinet(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    // Open Profile screen via rail button
    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(page.locator('.career-profile-screen-view')).toBeVisible();

    // Verify Decision Profile panel exists in the side rail
    const panel = page.locator('.career-decision-profile');
    await expect(panel).toBeVisible();

    // Confidentiality banner check
    const banner = panel.locator('.career-decision-confidential-banner');
    await expect(banner).toContainText('Конфиденциально');
    await expect(banner).toContainText('не уходят во внешние выгрузки');

    // Fill Salary floor
    const floorInput = panel.getByLabel('Зарплатный пол');
    await floorInput.fill('400000');

    // Fill Citizenship
    const citizenInput = panel.getByLabel('Гражданство');
    await citizenInput.fill('РФ');

    // Fill Tax status
    const taxInput = panel.getByLabel('Налоговый и миграционный статус');
    await taxInput.fill('Самозанятый');

    // Select work format
    const remoteCheckbox = panel.getByLabel('Удалёнка из РФ');
    await remoteCheckbox.check();

    // Fill languages
    const langInput = panel.getByLabel('Подтверждённые языки');
    await langInput.fill('Английский C1, Немецкий B2');

    // Fill Cushion
    const cushionInput = panel.getByLabel('Финансовая подушка (в месяцах)');
    await cushionInput.fill('6');

    // Family checkbox
    const familyCheckbox = panel.getByLabel('Семья и переезд с близкими');
    await familyCheckbox.check();

    // Save decision profile
    const saveButton = panel.getByRole('button', { name: 'Сохранить ограничения' });
    await saveButton.click();

    // Verify saved feedback
    await expect(panel.locator('.career-decision-saved')).toBeVisible();
    await expect(panel.locator('.career-decision-saved')).toContainText('Ограничения сохранены');

    // Check localStorage persistence
    const stored = await page.evaluate(() => {
      const raw = window.localStorage.getItem('openqareer.decision-profile.v1');
      return raw ? JSON.parse(raw) : null;
    });
    expect(stored).not.toBeNull();
    expect(stored.salaryFloor).toBe(400000);
    expect(stored.citizenship).toContain('РФ');
    expect(stored.taxStatus).toBe('Самозанятый');
    expect(stored.cushionMonths).toBe(6);
    expect(stored.hasFamily).toBe(true);

    // Capture desktop screenshot
    await page.screenshot({
      path: 'output/playwright/B384/decision-profile-1440.png',
      fullPage: true,
    });

    // Switch to Vacancies screen
    await page.getByRole('button', { name: 'Вакансии', exact: true }).first().click();
    await expect(page.locator('.vacancies-screen')).toBeVisible();

    // Capture vacancies screenshot with filtered results
    await page.screenshot({
      path: 'output/playwright/B384/vacancies-filtered-1440.png',
      fullPage: true,
    });

    // 1176 viewport captures
    await page.setViewportSize({ width: 1176, height: 800 });
    await page.screenshot({
      path: 'output/playwright/B384/vacancies-filtered-1176.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(page.locator('.career-profile-screen-view')).toBeVisible();
    await page.screenshot({
      path: 'output/playwright/B384/decision-profile-1176.png',
      fullPage: true,
    });
  });

  test('verifies empty decision profile does not filter out any vacancies', async ({ page }) => {
    await mockSignedInCabinet(page);

    // Ensure clean / default decision profile
    await page.addInitScript(() => {
      window.localStorage.removeItem('openqareer.decision-profile.v1');
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    // Open Vacancies screen
    await page.getByRole('button', { name: 'Вакансии', exact: true }).first().click();
    await expect(page.locator('.vacancies-screen')).toBeVisible();

    // Vacancies list is populated
    const items = page.locator('.vac-list-item');
    await expect(items.first()).toBeVisible();
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('responsive mobile 390 captures decision profile and vacancies without overflow', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'Only runs in mobile-390 viewport');

    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    await page.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(page.locator('.career-profile-screen-view')).toBeVisible();

    // Verify no horizontal overflow on mobile
    const profileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(profileOverflow).toBeLessThanOrEqual(0);

    const panel = page.locator('.career-decision-profile');
    await expect(panel).toBeVisible();

    // Check banner and fields on mobile
    await expect(panel.locator('.career-decision-confidential-banner')).toBeVisible();
    await expect(panel.getByLabel('Зарплатный пол')).toBeVisible();

    await page.screenshot({
      path: 'output/playwright/B384/decision-profile-390.png',
      fullPage: false,
    });

    // Navigate to Vacancies
    await page.getByRole('button', { name: 'Вакансии', exact: true }).first().click();
    await expect(page.locator('.vacancies-screen')).toBeVisible();

    const vacanciesOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(vacanciesOverflow).toBeLessThanOrEqual(0);

    await page.screenshot({
      path: 'output/playwright/B384/vacancies-filtered-390.png',
      fullPage: false,
    });
  });
});
