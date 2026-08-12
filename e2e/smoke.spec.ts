import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: null }),
    });
  });
});

test('built career workspace is ready, operable and free of critical accessibility violations', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console:${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`page:${error.message}`));
  page.on('requestfailed', (request) => {
    browserErrors.push(`request:${new URL(request.url()).pathname}`);
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const shell = page.getByTestId('career-shell');
  await expect(shell).toBeVisible();
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy');
  await expect(page.getByRole('heading', { name: 'Начните с карьерного вопроса' })).toBeVisible();
  await expect(page.getByText('Загружаем рабочее пространство')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Начать диагностику' })).toBeEnabled();

  const accountButton = page.locator('button[aria-label="Открыть аккаунт"]:visible').last();
  await expect(accountButton).toBeEnabled();
  await accountButton.click();
  await expect(page.getByRole('dialog', { name: 'Аккаунт' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Аккаунт' })).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const accessibility = await new AxeBuilder({ page }).analyze();
  const criticalViolations = accessibility.violations.filter(
    (violation) => violation.impact === 'critical',
  );
  expect(criticalViolations).toEqual([]);
  expect(browserErrors).toEqual([]);
});
