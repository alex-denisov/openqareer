import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

test('B346 subscription management is usable on desktop and mobile', async ({ page }, testInfo) => {
  test.skip(
    !['desktop-1440', 'mobile-390'].includes(testInfo.project.name),
    'B346 uses the approved desktop and mobile viewports',
  );
  const isMobile = testInfo.project.name === 'mobile-390';
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.route('**/health', (route) => route.fulfill({ status: 200, body: 'fixture' }));
  await mockSignedInCabinet(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });

  const accountButton = page
    .locator('.career-account-button:visible, .career-account-trigger:visible')
    .first();
  await expect(accountButton).toBeVisible({ timeout: 20_000 });
  await expect(accountButton).toBeEnabled();
  await accountButton.click();

  const account = page.getByRole('dialog', { name: 'Аккаунт' });
  await expect(account).toBeVisible();
  await account.getByRole('button', { name: 'Подписка и платежи' }).click();
  await expect(account.getByText('Следующее списание')).toBeVisible();
  await expect(account.locator('.career-billing-overview')).toContainText(/3\s+990\s+₽/u);
  const receiptHistory = isMobile
    ? account.locator('.career-billing-receipt-cards:visible')
    : account.locator('.career-billing-table:visible');
  await expect(receiptHistory).toContainText('Ссылка на чек пока не получена');
  await page.screenshot({
    path: testInfo.outputPath(
      isMobile ? 'b346-account-active-390.png' : 'b346-account-active-1440.png',
    ),
    fullPage: true,
  });
  await receiptHistory.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(
      isMobile ? 'b346-account-receipt-390.png' : 'b346-account-receipt-1440.png',
    ),
    fullPage: true,
  });

  await account.getByRole('button', { name: 'Отключить автопродление' }).click();
  await expect(account.getByText(/Автопродление отключено/u)).toBeVisible();
  await expect(account.getByText(/Доступ действует до 8 ноября/u)).toBeVisible();
  await expect(account.getByText('Следующее списание')).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.screenshot({
    path: testInfo.outputPath(
      isMobile ? 'b346-account-cancelled-390.png' : 'b346-account-cancelled-1440.png',
    ),
    fullPage: true,
  });
});
