import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE = e2eEvidenceDirectory('AUD-15');
const STEP_TITLES = ['Образование', 'Семья и сроки', 'Языки'];
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
  // B445: на 1440 — строка-раскрытие и кнопка внутри, на 390 — строка-переход.
  const openButton = page.getByRole('button', { name: 'Открыть «Страны и релокация»' });
  await page
    .locator('summary.career-relocation-head, button.career-m-row:has-text("Страны и релокация")')
    .first()
    .click();
  if (await openButton.isVisible()) await openButton.click();
  await expect(page.getByRole('heading', { name: 'Страны и релокация' }).first()).toBeVisible();
}

/** Desktop names each step in a heading; 390 keeps one title and says «Шаг N из 4». */
async function expectStep(page: Page, info: TestInfo, step: number): Promise<void> {
  if (isMobile(info)) {
    await expect(page.getByText(`Шаг ${step} из 4`)).toBeVisible();
    return;
  }
  const titles = ['Гражданство и документы', ...STEP_TITLES];
  await expect(page.getByRole('heading', { name: titles[step - 1] }).first()).toBeVisible();
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

  // Mockup 15 at 390 has no «Позже»: the push bar's back returns to the roles.
  await page.getByRole('button', { name: isMobile(info) ? 'Назад к ролям' : 'Позже' }).click();
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
  // 390 draws the consent as an iOS switch (mockup 15 `view=off`), 1440 as a checkbox.
  await page.getByRole(isMobile(info) ? 'switch' : 'checkbox').check();
  await page.getByRole('button', { name: 'Заполнить анкету' }).click();
  await expectStep(page, info, 1);

  await pickCountry(page, 'relocation-citizenship-first', 'Рос', 'Россия');
  await capture(page, info, 'relocation-questionnaire-1');
  for (const step of [2, 3, 4]) {
    await page.getByRole('button', { name: 'Дальше' }).click();
    await expectStep(page, info, step);
  }
  await page.getByRole('button', { name: 'Показать итог' }).click();
  // B468-r3: 1440 по кадру i5 — «Что получилось», 390 по кадру mv=i5 — «Анкета заполнена».
  await expect(
    page.getByRole('heading', { name: isMobile(info) ? 'Анкета заполнена' : 'Что получилось' }),
  ).toBeVisible();
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
  if (isMobile(info)) {
    // 390: delete lives on the document's own screen, saved with the step.
    await page.getByRole('button', { name: /ВНЖ, Сербия/u }).click();
    await expectStep(page, info, 1);
    await page.getByRole('button', { name: /ВНЖ, Сербия/u }).click();
    await page.getByRole('button', { name: 'Удалить документ' }).click();
    await page.getByRole('button', { name: 'Дальше' }).click();
    await expectStep(page, info, 2);
  } else {
    await page.getByRole('button', { name: 'Удалить: Вид на жительство' }).click();
    await expect(page.getByRole('button', { name: 'Удалить: Вид на жительство' })).toHaveCount(0);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);
  await page.getByRole('tab', { name: /^(Мои данные|Данные)$/u }).click();
  const citizenship = isMobile(info)
    ? 'Изменить: Гражданство: Россия'
    : 'Удалить: Гражданство: Россия';
  await expect(page.getByRole('button', { name: citizenship })).toBeVisible();
  await expect(page.getByText(/Вид на жительство|ВНЖ, Сербия/u)).toHaveCount(0);
  await capture(page, info, 'relocation-data');

  await page.getByRole('button', { name: 'Изменить: Гражданство: Россия' }).click();
  await expectStep(page, info, 1);
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
  const sheet = page.getByRole('dialog', { name: 'Сценарий' });
  await expect(sheet).toBeVisible();
  await capture(page, info, 'relocation-scenario-sheet');
  await sheet.getByRole('button', { name: 'Закрыть' }).click();

  await page.locator('.career-relocation-group-list button', { hasText: 'Германия' }).click();
  await expect(page.getByRole('heading', { name: 'Почему так' })).toBeVisible();
  await capture(page, info, 'relocation-country-push');
  await page.getByRole('button', { name: 'Назад', exact: true }).first().click();

  await page.getByRole('tab', { name: 'Данные' }).click();
  await page.getByRole('button', { name: 'Изменить: Гражданство: Россия' }).click();
  await expect(page.getByRole('heading', { name: 'Условия для переезда' })).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Есть второе гражданство' })).toBeVisible();
  await capture(page, info, 'relocation-questionnaire-push');
  await page.getByRole('button', { name: 'Добавить документ' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Документ' })).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await pickCountry(page, 'relocation-new-document-country', 'Серб', 'Сербия');
  await page.getByLabel('Действует до').fill('2027-03-14');
  await capture(page, info, 'relocation-document-push');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('button', { name: /ВНЖ, Сербия.*до 14\.03\.2027/u })).toBeVisible();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await expectStep(page, info, 2);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRelocation(page, info);
  await page.getByRole('tab', { name: 'Данные' }).click();
  await expect(page.getByRole('button', { name: /ВНЖ, Сербия.*до 14\.03\.2027/u })).toBeVisible();
});
