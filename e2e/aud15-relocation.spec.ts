import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE = e2eEvidenceDirectory('AUD-15');
const STEP_TITLES = ['Диплом и опыт', 'Семья и сроки', 'Языки'];
const isMobile = (info: TestInfo) => info.project.name === 'mobile-390';

async function openCareer(page: Page, info: TestInfo): Promise<void> {
  if (isMobile(info)) {
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
  await expect(
    page.getByTestId('career-screen').getByRole('heading', { level: 1, name: 'Карьера' }),
  ).toBeVisible();
}

async function openRelocation(page: Page, info: TestInfo): Promise<void> {
  await openCareer(page, info);
  await page
    .getByRole('button', { name: /^(Включить релокацию|Открыть страны и релокацию)$/u })
    .click();
  await expect(page.getByRole('heading', { name: 'Страны и релокация' }).first()).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({
    path: join(EVIDENCE, `${name}-${info.project.name}.png`),
    fullPage: true,
  });
}

async function pickCountry(page: Page, fieldId: string, query: string, name: string) {
  await page.locator(`#${fieldId}`).click();
  await page.getByRole('searchbox', { name: 'Поиск: Страна' }).fill(query);
  await page.getByRole('option', { name }).getByRole('button').click();
}

test('switched-off state: «Позже» goes back to roles and writes nothing', async ({
  page,
}, info) => {
  await mockSignedInCabinet(page);
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('relocation-questionnaire') && request.method() !== 'GET')
      writes.push(request.method());
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);
  await expect(page.getByRole('heading', { name: 'Что появится после включения' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Что мы спросим' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Заполнить анкету' })).toBeDisabled();
  await capture(page, info, 'relocation-off');

  await page.getByRole('button', { name: 'Позже' }).click();
  await expect(
    page.getByTestId('career-screen').getByRole('heading', { level: 1, name: 'Карьера' }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test('consent, questionnaire to the summary, countries, comparison and economy', async ({
  page,
}, info) => {
  await mockSignedInCabinet(page, { relocation: { consentTextApproved: true } });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Заполнить анкету' }).click();
  await expect(page.getByRole('heading', { name: 'Гражданство и документы' })).toBeVisible();

  await pickCountry(page, 'relocation-citizenship-first', 'Рос', 'Россия');
  await capture(page, info, 'relocation-questionnaire-1');
  for (const step of [2, 3, 4]) {
    await page.getByRole('button', { name: 'Дальше' }).click();
    await expect(page.getByRole('heading', { name: STEP_TITLES[step - 2] }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Показать итог' }).click();
  await expect(page.getByRole('heading', { name: 'Анкета заполнена' })).toBeVisible();
  await capture(page, info, 'relocation-questionnaire-summary');
  await page.getByRole('button', { name: 'Показать страны' }).click();
  if (isMobile(info)) return;

  await expect(page.getByRole('tab', { name: 'Страны 17' })).toBeVisible();
  for (const country of ['Германия', 'Казахстан']) {
    await page
      .locator('.career-relocation-country-card', { hasText: country })
      .getByRole('button', { name: 'В сравнение' })
      .click();
  }
  await expect(page.getByRole('tab', { name: 'Сравнение 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Сравнить страны' }).click();
  await expect(page.getByRole('heading', { name: 'Сравнение: Германия, Казахстан' })).toBeVisible();
  await capture(page, info, 'relocation-comparison');
  await page.getByRole('button', { name: 'Посчитать экономику' }).click();
  await expect(page.getByRole('heading', { name: 'Экономика переезда' })).toBeVisible();
  await capture(page, info, 'relocation-economy');
});

test('adds a country by search and pins it to the list', async ({ page }, info) => {
  test.skip(isMobile(info), 'desktop list; 390 has its own push test');
  await mockSignedInCabinet(page, {
    relocation: { consentGranted: true, citizenshipCountryCodes: ['RU'] },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);
  await expect(
    page.locator('.career-relocation-country-card', { hasText: 'Сингапур' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Добавить страну' }).click();
  await page.getByRole('searchbox', { name: 'Поиск страны' }).fill('Синг');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await capture(page, info, 'relocation-add-country');
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(
    page.locator('.career-relocation-country-card', { hasText: 'Сингапур' }),
  ).toHaveCount(1);
});

test('«Мои данные»: delete a document, edit opens the questionnaire, revoke deletes data', async ({
  page,
}, info) => {
  await mockSignedInCabinet(page, {
    relocation: {
      consentGranted: true,
      currentStep: 'summary',
      citizenshipCountryCodes: ['RU'],
      documents: [{ id: 'permit-1', kind: 'residence_permit', countryCode: 'RS' }],
    },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);
  await page.getByRole('tab', { name: /^(Мои данные|Данные)$/u }).click();
  await page.getByRole('button', { name: 'Удалить: Вид на жительство' }).click();
  await expect(page.getByRole('button', { name: 'Удалить: Вид на жительство' })).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);
  await page.getByRole('tab', { name: /^(Мои данные|Данные)$/u }).click();
  await expect(page.getByRole('button', { name: 'Удалить: Гражданство: Россия' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Удалить: Вид на жительство' })).toHaveCount(0);
  await capture(page, info, 'relocation-data');

  await page.getByRole('button', { name: 'Изменить: Гражданство: Россия' }).click();
  await expect(page.getByRole('heading', { name: 'Гражданство и документы' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад', exact: true }).first().click();

  await page.getByRole('tab', { name: /^(Мои данные|Данные)$/u }).click();
  await page
    .getByRole('button', { name: 'Отозвать согласие и удалить данные', exact: true })
    .click();
  await page
    .getByRole('group', { name: 'Отозвать согласие?' })
    .getByRole('button', { name: 'Отозвать согласие и удалить данные' })
    .click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);
  await expect(page.getByText('Согласие отозвано. Данные анкеты удалены.')).toBeVisible();
});

test('390: country push screen, scenario sheet and document screen', async ({ page }, info) => {
  test.skip(!isMobile(info), 'mobile-only push screens');
  await mockSignedInCabinet(page, {
    relocation: { consentGranted: true, citizenshipCountryCodes: ['RU'] },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);

  await page.getByRole('button', { name: 'Сценарий' }).click();
  const sheet = page.getByRole('dialog', { name: 'Сценарий переезда' });
  await expect(sheet).toBeVisible();
  await capture(page, info, 'relocation-scenario-sheet');
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  await page.locator('.career-relocation-group-list button', { hasText: 'Германия' }).click();
  await expect(page.getByRole('heading', { name: 'Почему так' })).toBeVisible();
  await capture(page, info, 'relocation-country-push');
  await page.getByRole('button', { name: 'Назад', exact: true }).first().click();

  await page.getByRole('tab', { name: 'Данные' }).click();
  await page.getByRole('button', { name: 'Изменить: Гражданство: Россия' }).click();
  await page.getByRole('button', { name: 'Добавить документ' }).click();
  await expect(page.getByRole('heading', { name: 'Документ', exact: true })).toBeVisible();
  await pickCountry(page, 'relocation-new-document-country', 'Серб', 'Сербия');
  await capture(page, info, 'relocation-document-push');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Вид на жительство, Сербия')).toBeVisible();
});
