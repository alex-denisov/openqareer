import { expect, test } from '@playwright/test';
import { candidate } from './fixtures/readabilityWorkspace';

/**
 * PRB-038 — сессия, истёкшая при открытом кабинете.
 *
 * Досье показывалось из кэша, а «Подключения» и «Регулярные выборки» писали
 * каждый своё: «Сессия закончилась», «Нужна действующая сессия кандидата».
 * Первый же `401` с кандидатского маршрута теперь уводит на вход целиком, с
 * одним объяснением, и ни один экран не остаётся «вошедшим».
 */
test('a 401 on a candidate route sends the whole app to sign in once', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { data: candidate } });
    if (path.includes('/candidate/')) {
      return route.fulfill({
        status: 401,
        json: { error: { code: 'unauthorized', message: 'Нужна действующая сессия кандидата.' } },
      });
    }
    return route.fulfill({ json: { data: null } });
  });

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('Сессия закончилась');
  await expect(page.getByRole('heading', { name: 'Вход в кабинет' })).toBeVisible();
  await expect(page.getByText('Нужна действующая сессия')).toHaveCount(0);
  await expect(page.getByText('Выйти')).toHaveCount(0);
});
