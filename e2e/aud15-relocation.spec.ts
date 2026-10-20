import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { e2eEvidenceDirectory } from './fixtures/evidencePath';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const EVIDENCE = e2eEvidenceDirectory('AUD-15');

async function openCareer(page: Page, projectName: string): Promise<void> {
  if (projectName === 'mobile-390') {
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

async function openRelocationWorkspace(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /^(Включить релокацию|Открыть страны и релокацию)$/u })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Страны и релокация' })).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({
    path: join(EVIDENCE, `${name}-${info.project.name}.png`),
    fullPage: true,
  });
}

test('opens the relocation screen from the Career page at 1440 and 390', async ({ page }, info) => {
  await mockSignedInCabinet(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openCareer(page, info.project.name);
  const entry = page.getByRole('button', { name: 'Включить релокацию' });
  await expect(entry).toBeVisible();
  await capture(page, info, 'career-relocation-entry');

  await entry.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Страны и релокация' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Что появится после включения' })).toBeVisible();
  await expect(
    page.getByText('Текст согласия ожидает проверки и пока не может быть принят.'),
  ).toBeVisible();
  await capture(page, info, 'relocation-consent-pending');

  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await expect(
    page.getByTestId('career-screen').getByRole('heading', { level: 1, name: 'Карьера' }),
  ).toBeVisible();
  const reopen = page.getByRole('button', { name: 'Открыть страны и релокацию' });
  await expect(reopen).toBeVisible();
  await reopen.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Страны и релокация' })).toBeVisible();
});

test('compares countries, calculates income, and persists profile changes', async ({
  page,
}, info) => {
  await mockSignedInCabinet(page, {
    relocation: {
      consentGranted: true,
      documents: [
        {
          id: 'permit-1',
          kind: 'residence_permit',
          countryCode: 'DE',
          expiresAt: '2026-10-20',
        },
      ],
    },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openCareer(page, info.project.name);
  await openRelocationWorkspace(page);
  await capture(page, info, 'relocation-countries');
  await page.getByRole('tab', { name: /Сравнение/u }).click();
  await expect(page.getByText('Выберите страны для сравнения.')).toBeVisible();
  await capture(page, info, 'relocation-comparison-empty');
  await page.getByRole('tab', { name: /Страны/u }).click();

  const scenario = page.getByLabel('Сценарий');
  await scenario.selectOption('employer_sponsorship');
  await page.getByRole('button', { name: 'Добавить страну' }).click();
  const search = page.getByRole('searchbox', { name: 'Поиск страны' });
  await search.fill('Германия');
  const germanyName = page.getByRole('button', { name: /^Германия/u });
  await expect(germanyName).toBeVisible();
  await germanyName.click();
  await expect(page.getByRole('heading', { name: 'Германия' })).toBeVisible();
  await expect(page.locator('.career-relocation-country-details a').first()).toHaveAttribute(
    'href',
    /^https:\/\//u,
  );
  await capture(page, info, 'relocation-country-details');

  const germanyRow = page.locator('li.career-relocation-country-row').filter({ has: germanyName });
  await germanyRow.getByRole('button', { name: 'В сравнение' }).click();
  await page.getByRole('button', { name: 'Сбросить сценарий и поиск' }).click();
  await page.getByRole('button', { name: 'Добавить страну' }).click();
  await page.getByRole('button', { name: 'Показать все 17' }).click();
  await expect(page.locator('li.career-relocation-country-row')).toHaveCount(17);
  const serbiaRow = page.locator('li.career-relocation-country-row').filter({
    has: page.getByRole('button', { name: /^Сербия/u }),
  });
  await serbiaRow.getByRole('button', { name: 'В сравнение' }).click();
  await page.getByRole('button', { name: 'Сравнить страны' }).click();
  await expect(page.getByRole('heading', { name: 'Сравнение стран' })).toBeVisible();
  await capture(page, info, 'relocation-comparison');

  await page.getByRole('tab', { name: 'Страны 17' }).click();
  await page.getByRole('button', { name: /^Германия/u }).click();
  await page.getByRole('button', { name: 'Посчитать экономику' }).click();
  const income = page.getByLabel('Годовая зарплата до налогов');
  await income.fill('-1');
  await expect(page.getByRole('alert')).toContainText('Укажите годовую зарплату');
  await capture(page, info, 'relocation-calculation-error');
  await income.fill('12000');
  await expect(page.getByRole('heading', { name: 'Зарплата ниже порога' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить расчёт в профиль' })).toBeEnabled();
  await capture(page, info, 'relocation-economy-below-threshold');

  await page.getByRole('tab', { name: 'Мои данные' }).click();
  const alerts = page.getByLabel('Предупреждения профиля');
  await expect(alerts).toContainText('Укажите страну гражданства');
  await expect(alerts).toContainText('истекает 20.10.2026');
  await capture(page, info, 'relocation-profile-alerts');

  const citizenship = page.getByRole('region', { name: 'Гражданство и документы' });
  await citizenship.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Добавить гражданство').selectOption('RU');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await capture(page, info, 'relocation-questionnaire-citizenship');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await expect(page.getByRole('heading', { name: 'Диплом и опыт' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад к данным' }).click();
  await expect(page.getByRole('heading', { name: 'Мои данные' })).toBeVisible();
  await expect(page.getByText('Россия', { exact: true })).toBeVisible();
  await expect(alerts).not.toContainText('Укажите страну гражданства');
  await expect(alerts).toContainText('истекает 20.10.2026');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openCareer(page, info.project.name);
  await openRelocationWorkspace(page);
  await page.getByRole('tab', { name: 'Мои данные' }).click();
  await expect(page.getByText('Россия', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Предупреждения профиля')).not.toContainText(
    'Укажите страну гражданства',
  );
  await capture(page, info, 'relocation-profile-reloaded');

  await page
    .getByRole('button', { name: 'Отозвать согласие и удалить данные', exact: true })
    .click();
  const confirmation = page.getByRole('group', { name: 'Отозвать согласие?' });
  await confirmation.getByRole('button', { name: 'Отозвать согласие и удалить данные' }).click();
  await expect(page.getByRole('heading', { name: 'Согласие отозвано' })).toBeVisible();
  await capture(page, info, 'relocation-consent-revoked');
});

test('resumes an interrupted relocation questionnaire', async ({ page }, info) => {
  await mockSignedInCabinet(page, {
    relocation: { consentGranted: true, currentStep: 'education' },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openCareer(page, info.project.name);
  await openRelocationWorkspace(page);
  await page.getByRole('tab', { name: 'Мои данные' }).click();
  const resume = page.getByRole('button', { name: 'Продолжить с шага 2' });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(page.getByText('Шаг 2 из 4: Диплом и опыт')).toBeVisible();
  await capture(page, info, 'relocation-questionnaire-interrupted');

  await page.getByRole('button', { name: 'Назад к данным' }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  const confirmation = page.getByRole('group', { name: 'Очистить анкету?' });
  const restartRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith('/candidate/relocation-questionnaire') &&
      request.method() === 'DELETE',
  );
  await confirmation.getByRole('button', { name: 'Очистить анкету' }).click();
  await restartRequest;
  await expect(page.getByText('Анкета очищена. Согласие осталось активным.')).toBeVisible();
  await capture(page, info, 'relocation-questionnaire-reset');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await openCareer(page, info.project.name);
  await openRelocationWorkspace(page);
  await page.getByRole('tab', { name: 'Мои данные' }).click();
  await expect(page.getByRole('button', { name: 'Заполнить анкету' })).toBeVisible();
});

test('shows empty comparison, calculation error, and stale tax data states', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Date.now = () => Date.parse('2027-01-10T12:00:00.000Z');
  });
  await mockSignedInCabinet(page, {
    relocation: { consentGranted: true, citizenshipCountryCodes: ['RU'] },
  });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openCareer(page, info.project.name);
  await openRelocationWorkspace(page);

  await page.getByRole('tab', { name: /Сравнение/u }).click();
  await expect(page.getByText('Выберите страны для сравнения.')).toBeVisible();
  await capture(page, info, 'relocation-comparison-empty-state');
  await page.getByRole('tab', { name: /Страны/u }).click();
  await page.getByRole('button', { name: /^Канада/u }).click();
  await expect(
    page
      .getByText(
        'Нет проверенного официального набора правил для этого маршрута. Числовые пороги не показываются.',
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await capture(page, info, 'relocation-country-no-data');
  await page.getByRole('button', { name: 'Свернуть', exact: true }).click();
  await page.getByRole('button', { name: /^Германия/u }).click();
  await page.getByRole('button', { name: 'Посчитать экономику' }).click();

  const income = page.getByLabel('Годовая зарплата до налогов');
  await income.fill('-1');
  await expect(page.getByRole('alert')).toContainText('Укажите годовую зарплату');
  await capture(page, info, 'relocation-calculation-error-state');
  await income.fill('40000');
  const stale = page.getByLabel('Данные устарели');
  await expect(stale).toContainText('прошло больше 90 дней');
  await capture(page, info, 'relocation-tax-data-stale');

  await page.setViewportSize({ width: 390, height: 844 });
  const back = page
    .locator('main.career-relocation')
    .getByRole('button', { name: 'Назад', exact: true });
  const backBox = await back.boundingBox();
  expect(backBox?.width).toBeGreaterThanOrEqual(44);
  expect(backBox?.height).toBeGreaterThanOrEqual(44);
  await back.focus();
  await page.keyboard.press('Tab');
  const visibleFocus = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.matches(':focus-visible')) return false;
    const style = getComputedStyle(active);
    return (
      (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') || style.boxShadow !== 'none'
    );
  });
  expect(visibleFocus).toBe(true);

  for (const width of [280, 320, 414]) {
    await page.setViewportSize({ width, height: 844 });
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
    if (width === 280) await capture(page, info, 'relocation-width-280');
  }
});

test('opens vacancy results from a relocation country card', async ({ page }, info) => {
  await mockSignedInCabinet(page, { relocation: { consentGranted: true } });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await openCareer(page, info.project.name);
  await openRelocationWorkspace(page);

  const germanyRow = page.locator('li.career-relocation-country-row').filter({
    has: page.getByRole('button', { name: /^Германия/u }),
  });
  await germanyRow.getByRole('button', { name: 'Вакансии' }).click();
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Вакансии', exact: true }),
  ).toBeVisible();
  await capture(page, info, 'relocation-vacancies-open');
});
