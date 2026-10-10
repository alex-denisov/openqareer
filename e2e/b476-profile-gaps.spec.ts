import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

test.describe('B476: Profile gaps mechanics (About, Review, Versions)', () => {
  test.beforeAll(async () => {
    await mkdir('/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/evidence/B476', {
      recursive: true,
    });
    await mkdir('output/playwright/B476', { recursive: true });
  });

  test('profile screen renders and activates all B476 actions', async ({ page }, testInfo) => {
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    const isMobile = testInfo.project.name === 'mobile-390';
    if (isMobile) {
      await page.locator('.career-mobile-nav').getByRole('button', { name: 'Профиль' }).click();
    } else {
      await page.locator('aside#career-rail nav').getByRole('button', { name: 'Профиль' }).click();
    }

    // Verify sections and action buttons are present
    const fixWithConsultantBtn = page.locator('[data-testid="review-fix-with-consultant-btn"]');
    await expect(fixWithConsultantBtn).toBeVisible();

    const fillQuestionnaireBtn = page.locator('[data-testid="review-fill-questionnaire-btn"]');
    await expect(fillQuestionnaireBtn).toBeVisible();

    const aboutEditBtn = page.locator('[data-testid="about-edit-text-btn"]');
    await expect(aboutEditBtn).toBeVisible();

    const aboutSuggestBtn = page.locator('[data-testid="about-consultant-suggest-btn"]');
    await expect(aboutSuggestBtn).toBeVisible();

    const createVersionBtn = page.locator('[data-testid="create-targeted-version-btn"]');
    await expect(createVersionBtn).toBeVisible();

    const prefix = isMobile ? '390' : '1440';
    await page.screenshot({
      path: `/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/evidence/B476/b476-profile-${prefix}.png`,
      fullPage: false,
    });

    // Test targeted version creation
    await createVersionBtn.click();
    const versionInput = page.locator('[data-testid="targeted-version-input"]');
    await expect(versionInput).toBeVisible();
    await versionInput.fill('Вектор Банк');
    await page.locator('[data-testid="submit-targeted-version-btn"]').click();

    await expect(page.getByText('Под вакансию «Вектор Банк»')).toBeVisible();
    await expect(page.getByText('Черновик ждёт вашего одобрения')).toBeVisible();

    await page.screenshot({
      path: `/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/evidence/B476/b476-profile-version-created-${prefix}.png`,
      fullPage: false,
    });

    // Test consultant suggestion in About
    await aboutSuggestBtn.click();
    await expect(page.getByText('Консультант сформулировал управленческий масштаб')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Принять' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отклонить' }).first()).toBeVisible();

    // Test edit text in About
    await aboutEditBtn.click();
    await expect(page.locator('textarea#about-edit-input')).toBeVisible();

    await page.screenshot({
      path: `/Users/alexeydenisov/Projects/openqareer/docs/v1-release/tasks/evidence/B476/b476-profile-about-edit-${prefix}.png`,
      fullPage: false,
    });
  });
});
