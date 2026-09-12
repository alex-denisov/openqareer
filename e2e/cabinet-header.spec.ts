import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const candidate = {
  username: 'qa-candidate',
  email: 'qa-candidate@example.com',
  displayName: 'Кандидат с длинным именем',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-b213',
};

test('B213: signed-in public header stays inside the viewport', async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
  page.on('requestfailed', (request) => {
    browserErrors.push(`request:${new URL(request.url()).pathname}`);
  });

  await page.route('**/api/v1/auth/me', async (route) => {
    await route.fulfill({ json: { data: candidate } });
  });
  await page.route('**/api/v1/candidate/workspace', async (route) => {
    await route.fulfill({ json: { data: null } });
  });
  await page.goto('/cabinet', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy');

  const headerActions = page.locator('.site-header-actions');
  await expect(headerActions.getByRole('link', { name: 'В кабинет' })).toBeVisible();

  const layout = await page.evaluate(() => {
    const actions = document.querySelector('.site-header-actions')?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      actionsRight: actions?.right ?? Number.POSITIVE_INFINITY,
      viewportRight: document.documentElement.clientWidth,
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(0);
  expect(layout.actionsRight).toBeLessThanOrEqual(layout.viewportRight);

  if (testInfo.project.name === 'mobile-390') {
    await page.setViewportSize({ width: 320, height: 844 });
    const narrowOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(narrowOverflow).toBeLessThanOrEqual(0);
  }

  await page.screenshot({ path: testInfo.outputPath('header.png') });

  const accessibility = await new AxeBuilder({ page }).include('.site-header').analyze();
  expect(accessibility.violations.filter((violation) => violation.impact === 'critical')).toEqual(
    [],
  );
  expect(browserErrors).toEqual([]);
});
