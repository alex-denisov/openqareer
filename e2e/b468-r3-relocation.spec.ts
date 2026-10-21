import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import {
  calculateRelocationScenario,
  relocationScenarioInputSchema,
  type SavedRelocationScenario,
} from '../shared/relocationScenario';

async function openRelocation(page: Page, mobile: boolean) {
  if (mobile) {
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Ещё' })
      .click();
    await page.getByRole('menuitem', { name: 'Карьера' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Разделы кабинета' })
      .getByRole('button', { name: 'Карьера' })
      .click();
  }
  const openButton = page.getByRole('button', { name: 'Открыть «Страны и релокация»' });
  await page
    .locator('summary.career-relocation-head, button.career-m-row:has-text("Страны и релокация")')
    .first()
    .click();
  if (await openButton.isVisible()) await openButton.click();
}

async function pickCountry(page: Page, fieldId: string, query: string, name: string) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole('searchbox', { name: 'Поиск: Страна' }).fill(query);
  await page.getByRole('option', { name }).getByRole('button').click();
}

test('B468-r3: Russia + Serbian permit → «Что получилось» → Serbia open in the list', async ({
  page,
}, info) => {
  test.skip(info.project.name === 'mobile-390', 'Кадр i5 1440; 390 проверяется отдельным тестом.');
  await mockSignedInCabinet(page, { relocation: { consentTextApproved: true } });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openRelocation(page, false);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Заполнить анкету' }).click();

  await pickCountry(page, 'relocation-citizenship-first', 'Рос', 'Россия');
  await pickCountry(page, 'relocation-new-document-country', 'Серб', 'Сербия');
  await page.locator('#relocation-new-document-expires').fill('2099-06-30');
  await page.getByRole('button', { name: 'Добавить документ' }).click();
  await expect(page.getByRole('button', { name: 'Изменить: ВНЖ, Сербия' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Удалить: ВНЖ, Сербия' })).toBeVisible();
  await page.getByRole('button', { name: 'Дальше' }).click();
  for (let step = 0; step < 3; step += 1)
    await page.getByRole('button', { name: 'Пропустить шаг' }).click();

  await expect(page.getByRole('heading', { name: 'Что получилось' })).toBeVisible();
  await expect(page.getByText('Релокация включена')).toBeVisible();
  const serbia = page.locator('.career-relocation-summary-list li', { hasText: 'Сербия' });
  await expect(serbia).toContainText('Доступно без ограничений');
  await expect(serbia).toContainText('Действует ВНЖ до 30.06.2099.');

  await page.getByRole('button', { name: 'Показать страны' }).click();
  const card = page.locator('.career-relocation-country-card', { hasText: 'Сербия' });
  await expect(card).toContainText('Доступно без ограничений');
  const names = await page.locator('.career-relocation-country-card').allInnerTexts();
  const index = names.findIndex((text) => text.includes('Сербия'));
  expect(index).toBeGreaterThanOrEqual(0);
  expect(index).toBeLessThan(6);
});

test('B468-r3: 390 «Экономика» saves the calculation and it survives a reload', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'mobile-390', 'Кадр vt=net 390.');
  await mockSignedInCabinet(page, { relocation: { consentGranted: true } });
  const saved: SavedRelocationScenario[] = [];
  await page.route('**/api/v1/candidate/relocation-scenarios**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const input = relocationScenarioInputSchema.parse(request.postDataJSON());
      const item: SavedRelocationScenario = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        input,
        result: calculateRelocationScenario(input),
        profileRevision: 0,
      };
      saved.unshift(item);
      await route.fulfill({ status: 201, json: { data: item } });
      return;
    }
    await route.fulfill({ json: { data: { items: saved, nextOffset: null } } });
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openRelocation(page, true);
  await page.getByRole('tab', { name: 'Экономика' }).click();
  await page.locator('#relocation-mobile-economy-country').selectOption('AE');
  await page.locator('#relocation-mobile-income').fill('120000');
  const save = page.getByRole('button', { name: 'Сохранить расчёт в профиль' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Город расчёта').fill('Дубай');
  await save.click();
  await expect(page.getByText('Расчёт сохранён в профиле.')).toBeVisible();
  expect(saved).toHaveLength(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRelocation(page, true);
  await page.getByRole('tab', { name: 'Экономика' }).click();
  await expect(page.getByText('ОАЭ, Дубай')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
