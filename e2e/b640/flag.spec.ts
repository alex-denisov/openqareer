import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

test.describe('B649: флаг нового кабинета', () => {
  test('без флага открывается прежний кабинет', async ({ page }) => {
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('career-shell').getByRole('main')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('cabinet-b640')).toHaveCount(0);
  });

  test('с флагом открывается новый корень, прежний кабинет не показан', async ({ page }) => {
    await mockSignedInCabinet(page, { cabinetB640: true });
    await page.goto('/app', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('career-shell')).toHaveCount(0);
  });
});
