import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

async function assertMobileNavInViewport(page: Page) {
  const navigation = page.locator('.career-mobile-nav');
  await expect(navigation).toBeVisible();
  await expect(navigation).toHaveAttribute('aria-label', 'Разделы');
  const rect = await navigation.boundingBox();
  const viewport = page.viewportSize();
  if (!rect || !viewport) throw new Error('The mobile navigation needs a viewport layout box.');
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + 1);
  return rect;
}

async function assertSaveActionAboveNav(page: Page, name: string) {
  const navigationRect = await assertMobileNavInViewport(page);
  const savebar = page.locator('.pm-savebar');
  await expect(savebar).toBeVisible();
  const button = savebar.getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  const rect = await button.boundingBox();
  const viewport = page.viewportSize();
  if (!rect || !viewport) throw new Error('The mobile save action needs a viewport layout box.');
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.y + rect.height + 4).toBeLessThanOrEqual(navigationRect.y);
}

async function assertPositionEditorSaveAction(page: Page) {
  const editor = page.locator('.profile-mobile-position-editor');
  await expect(editor).toBeVisible();
  const lastField = editor.getByRole('button', { name: 'Навык', exact: true });
  await lastField.scrollIntoViewIfNeeded();
  await expect(lastField).toBeVisible();
  await page.mouse.move(8, 500);
  await page.mouse.wheel(0, 320);
  await expect
    .poll(async () => {
      const fieldRect = await lastField.boundingBox();
      const savebarRect = await editor.locator('.pm-savebar').boundingBox();
      return Boolean(
        fieldRect && savebarRect && fieldRect.y + fieldRect.height + 4 <= savebarRect.y,
      );
    })
    .toBe(true);
  await assertSaveActionAboveNav(page, 'Сохранить');
}

async function assertMobileJobEditGeometry(page: Page) {
  const back = page.getByRole('button', { name: 'Назад', exact: true });
  const consultant = page.getByRole('button', { name: 'Консультант: открыть' });
  const periodStart = page
    .locator('.profile-mobile-position-editor .pm-group')
    .filter({ has: page.getByText('Период', { exact: true }) })
    .locator('.pm-field')
    .first();
  const description = page.getByRole('textbox', { name: 'Описание', exact: true });

  await expect.poll(async () => Math.round((await back.boundingBox())?.x ?? -1)).toBe(16);
  await expect.poll(async () => Math.round((await consultant.boundingBox())?.x ?? -1)).toBe(334);
  await expect.poll(async () => Math.round((await periodStart.boundingBox())?.y ?? -1)).toBe(264);
  await expect.poll(async () => Math.round((await description.boundingBox())?.y ?? -1)).toBe(523);
}

async function assertPage(page: Page, name: string) {
  await expect(page.locator('.career-profile-mobile')).toHaveAttribute(
    'data-mobile-profile-page',
    name,
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await assertMobileNavInViewport(page);
}

async function back(page: Page, expected = 'home') {
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await assertPage(page, expected);
}

test('approved mobile profile pages are separate reachable screens with working Back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSignedInCabinet(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page
    .locator('.career-mobile-nav')
    .getByRole('button', { name: 'Профиль', exact: true })
    .click();
  await assertPage(page, 'home');
  await expect(page.locator('.pm-id h2')).toBeVisible();
  for (const [label, route] of [
    ['Обо мне', 'about'],
    ['Образование', 'edu'],
    ['Проекты', 'proj'],
    ['Языки', 'lang'],
    ['Релокация', 'reloc'],
    ['Прохождение ATS', 'ats'],
    ['Проверка', 'check'],
    ['Версии под вакансии', 'docs'],
  ] as const) {
    await page
      .locator('.pm-row')
      .filter({ has: page.getByText(label, { exact: true }) })
      .click();
    await assertPage(page, route);
    await back(page);
  }
  await page
    .locator('.pm-row')
    .filter({ has: page.getByText('Опыт', { exact: true }) })
    .click();
  await assertPage(page, 'exp');
  await page.locator('.pm-row').filter({ hasText: 'Добавить место работы' }).click();
  await assertPage(page, 'jobadd');
  await assertPositionEditorSaveAction(page);
  await back(page, 'exp');
  await page.locator('.pm-row').filter({ hasNotText: 'Добавить место работы' }).first().click();
  await assertPage(page, 'job');
  await page.getByRole('button', { name: 'Изменить место' }).click();
  await assertPage(page, 'jobedit');
  await assertMobileJobEditGeometry(page);
  await assertPositionEditorSaveAction(page);
  await back(page, 'job');
  await back(page, 'exp');
  await back(page);
  await page.getByRole('button', { name: /^LinkedIn/ }).click();
  await assertPage(page, 'src');
  await back(page);
  await page.getByRole('tab', { name: 'Навыки', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить навык' }).click();
  await assertPage(page, 'skilladd');
  await assertSaveActionAboveNav(page, 'Добавить');
  await back(page);
  await expect(page.getByRole('tab', { name: 'Навыки', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'След', exact: true }).click();
  await expect(page.locator('.career-footprint-surface')).toBeVisible();
  await assertMobileNavInViewport(page);
});
