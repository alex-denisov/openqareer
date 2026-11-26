import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';

/**
 * B803: строка без зарплаты показывает оценку openqareer (макет v06b «≈ 545–635 тыс.»),
 * источник — в подсказке и в скрытом тексте для чтения с экрана. 1440 и 390 — проекты конфига.
 */
test('B803: оценка в строке списка вместо «не указана»', async ({ page }) => {
  await mockSignedInCabinet(page, { cabinetB640: true, vacancyTotal: 45 });
  await page.goto('/app/vacancies', { waitUntil: 'domcontentloaded' });
  const estimate = page.locator('.b640 tr.vt-row .vt-main[title*="Оценка openqareer"]').first();
  await expect(estimate).toBeVisible({ timeout: 15_000 });
  await expect(estimate).toHaveText(/^≈ /u);
  await expect(estimate.locator('.vt-est')).toHaveText('оценка');
  await expect(estimate).toHaveAttribute('title', /Оценка openqareer, 05\.10/u);
});
