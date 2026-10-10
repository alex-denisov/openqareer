import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

async function openVacancies(page: Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Подборка/u })).toBeVisible();
}

async function measureResponsiveWidths(page: Page, testInfo: TestInfo) {
  const widths = [280, 320, 390, 414, 1440] as const;
  const facts: Array<{
    requested: number;
    actual: number;
    overflow: number;
    actionHeights: number[];
    actionOutsideX: boolean;
  }> = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width > 640 ? 900 : 844 });
    facts.push(
      await page.evaluate((requested) => {
        const actual = window.innerWidth;
        const overflow =
          Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - actual;
        const actions = [
          ...document.querySelectorAll<HTMLElement>('.vacancy-collection-actions button'),
        ];
        const bounds = actions.map((button) => button.getBoundingClientRect());
        return {
          requested,
          actual,
          overflow,
          actionHeights: bounds.map((rect) => rect.height),
          actionOutsideX: bounds.some((rect) => rect.left < 0 || rect.right > actual + 1),
        };
      }, width),
    );
  }
  const factsPath = testInfo.outputPath('B446-responsive-facts.json');
  await writeFile(factsPath, JSON.stringify(facts, null, 2));
  await testInfo.attach('B446-responsive-facts.json', {
    path: factsPath,
    contentType: 'application/json',
  });
  expect(
    facts.every((item) => item.overflow <= 1),
    JSON.stringify(facts),
  ).toBe(true);
  expect(
    facts.every((item) => !item.actionOutsideX),
    JSON.stringify(facts),
  ).toBe(true);
  expect(facts.every((item) => item.actionHeights.every((height) => height >= 44))).toBe(true);
  const viewport =
    testInfo.project.name === 'mobile-390'
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 };
  await page.setViewportSize(viewport);
}

async function focusWithKeyboard(page: Page, target: Locator): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) {
      expect(await target.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
      return;
    }
  }
  throw new Error('Кнопка не достигнута последовательностью Tab.');
}

async function openFilters(page: Page) {
  await page.getByRole('button', { name: 'Фильтры и сохранённые запросы' }).click();
}

test('B446: filter a vacancy, save it, set company want, and keep it after reload', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page);
  await openVacancies(page);
  await measureResponsiveWidths(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath('B446-home.png'), fullPage: true });
  await openFilters(page);
  await page.screenshot({ path: testInfo.outputPath('B446-filters.png'), fullPage: true });

  const locationSearch = page.getByRole('searchbox', {
    name: 'Страна, регион, штат или город',
  });
  await locationSearch.fill('Berlin');
  const screenError = page.locator('.career-error-boundary-details code');
  if (await screenError.count())
    throw new Error((await screenError.textContent()) ?? 'Unknown screen error');
  await page.getByRole('button', { name: 'Применить' }).click();
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Фильтры и сохранённые запросы' }).click();
  }
  await page.screenshot({ path: testInfo.outputPath('B446-filtered.png'), fullPage: true });

  const vacancy = page
    .locator('.vac-list-item')
    .filter({ hasText: 'Product Lead, Merchant Onboarding' })
    .first();
  await expect(vacancy).toBeVisible();
  const saveButton = vacancy.getByRole('button', { name: 'Сохранить вакансию' });
  const companyWantButton = vacancy.getByRole('button', { name: 'Хочу в эту компанию' });
  await expect(saveButton).toBeVisible();
  const actionHeights = await vacancy
    .locator('.career-vacancy-actions button')
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(actionHeights.every((height) => height >= 44)).toBe(true);
  await companyWantButton.click();
  await expect(vacancy.getByRole('button', { name: 'Убрать из «Хочу»' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('B446-company-want.png'), fullPage: true });
  await vacancy.locator('.vac-row').click();
  const companyPathButton = vacancy.getByRole('button', { name: /Путь к компании/u });
  await focusWithKeyboard(page, companyPathButton);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /Компании и люди/u })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Revolut' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('B446-company-path.png'), fullPage: true });
  await page.getByRole('tab', { name: /Подборка/u }).click();
  await focusWithKeyboard(page, saveButton);
  await page.keyboard.press('Space');
  await expect(page.getByRole('tab', { name: 'Сохранённые 1' })).toBeVisible();

  await page.getByRole('tab', { name: 'Сохранённые 1' }).click();
  const savedSearch = page.getByRole('searchbox', {
    name: 'Компания или роль среди 1 сохранённых',
  });
  await savedSearch.fill('Merchant Onboarding');
  await expect(
    page.getByRole('heading', { name: 'Product Lead, Merchant Onboarding' }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('B446-saved.png'), fullPage: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openVacancies(page);
  const reloadedVacancy = page
    .locator('.vac-list-item')
    .filter({ hasText: 'Product Lead, Merchant Onboarding' })
    .first();
  const removeCompanyWant = reloadedVacancy.getByRole('button', { name: 'Убрать из «Хочу»' });
  await expect(removeCompanyWant).toBeVisible();
  await removeCompanyWant.click();
  await expect(reloadedVacancy.getByRole('button', { name: 'Хочу в эту компанию' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Сохранённые 1' })).toBeVisible();
  await page.getByRole('tab', { name: 'Сохранённые 1' }).click();
  await expect(
    page.getByRole('heading', { name: 'Product Lead, Merchant Onboarding' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('B446-saved-after-reload.png'),
    fullPage: true,
  });
});
