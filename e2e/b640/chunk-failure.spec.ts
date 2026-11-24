import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

test('кусок раздела не загрузился: каркас на месте, другой адрес и повтор открываются', async ({
  page,
}) => {
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.goto('/app/today', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="s04"], .page').first()).toBeVisible({
    timeout: 15_000,
  });

  await page.context().route(/\/assets\/.*\.(js|css)$/u, (route) => route.abort());
  await page.context().route('**/health', (route) => route.abort());
  const nav = (path: string) =>
    page.evaluate((to) => {
      document.querySelector<HTMLAnchorElement>(`a[href="${to}"]`)!.click();
    }, path);
  await nav('/app/vacancies');
  const failure = page.getByRole('alert').filter({ hasText: 'Что-то пошло не так' });
  await expect(failure).toBeVisible();
  await expectGates(page);
  await page.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect(failure).toBeVisible();

  // Уже загруженный раздел открывается и без связи.
  await nav('/app/today');
  await expect(failure).toHaveCount(0);

  await nav('/app/vacancies');
  await expect(failure).toBeVisible();
  await page.context().unroute(/\/assets\/.*\.(js|css)$/u);
  await page.context().unroute('**/health');
  await page.context().route('**/health', (route) => route.fulfill({ body: 'ok' }));
  await page.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect(failure).toHaveCount(0, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/app\/vacancies/u);
  await expect(page.locator('.page')).toBeVisible({ timeout: 15_000 });
});
