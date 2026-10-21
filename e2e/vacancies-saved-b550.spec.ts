import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

async function openSaved(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.click();
  await page.getByRole('tab', { name: /Сохранённые/u }).click();
  await expect(page.locator('.saved-row').first()).toBeVisible({ timeout: 15_000 });
}

const roles = (page: Page) => page.locator('.saved-row h3').allTextContents();

test('B550: saved tab searches, filters closed, sorts by money and keeps the choice', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page, { savedVacanciesCount: 6 });
  await openSaved(page);

  await expect(page.getByText(/ваша короткая подборка для разбора/u)).toBeVisible();
  await expect(page.getByText('Показано 6 из 6')).toBeVisible();
  await expect(page.locator('.saved-row').first()).toContainText('сохранено');
  // B446-g4: в строке звезда и «Хочу», ссылки «На площадке» нет (макет 4).
  await expect(
    page.locator('.saved-row').first().getByRole('link', { name: 'На площадке' }),
  ).toHaveCount(0);
  await expect(page.getByText('закрыта на площадке 06.10')).toBeVisible();

  if (testInfo.project.name === 'mobile-390') {
    await expect(page.getByRole('combobox', { name: 'Состояние' })).toBeHidden();
    mkdirSync('output/playwright/B550', { recursive: true });
    await page.screenshot({ path: 'output/playwright/B550/saved-mobile-390.png', fullPage: true });
    return;
  }

  const found = page.locator('.saved-row').filter({ hasText: 'Saved role 2' });
  await expect(found.locator('[data-label="Уровень"]')).toContainText('Head');
  await expect(found.locator('[data-label="Уровень"]')).toContainText('совпадает');
  await expect(found.locator('[data-label="Гео"]')).toContainText('Москва');
  const missing = page.locator('.saved-row').filter({ hasText: 'Saved role 3' });
  await expect(missing.locator('[data-label="Гео"]')).toContainText('нет в каталоге');
  await expect(missing.locator('[data-label="Уровень"]')).toContainText('—');

  const search = page.getByRole('searchbox', { name: 'Компания или роль среди 6 сохранённых' });
  await search.fill('Saved company 3');
  expect(await roles(page)).toEqual(['Saved role 3']);
  await search.fill('');

  await page.getByRole('combobox', { name: 'Состояние' }).selectOption('closed');
  expect(await roles(page)).toEqual(['Saved role 1']);
  await page.getByRole('combobox', { name: 'Состояние' }).selectOption('all');

  await page.getByRole('combobox', { name: 'Сортировка' }).selectOption('money');
  expect((await roles(page)).slice(0, 3)).toEqual(['Saved role 6', 'Saved role 4', 'Saved role 2']);

  mkdirSync('output/playwright/B550', { recursive: true });
  await page.screenshot({
    path: `output/playwright/B550/saved-${testInfo.project.name}.png`,
    fullPage: true,
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openSaved(page);
  await expect(page.getByRole('combobox', { name: 'Сортировка' })).toHaveValue('money');
  expect((await roles(page))[0]).toBe('Saved role 6');
});

test('B550: empty saved tab leads back to the selection', async ({ page }) => {
  await mockSignedInCabinet(page, { savedVacanciesCount: 0 });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await page.getByRole('tab', { name: /Сохранённые/u }).click();
  await page.getByRole('button', { name: 'Перейти в подборку' }).click();
  await expect(page.getByRole('tab', { name: /Подборка/u })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
