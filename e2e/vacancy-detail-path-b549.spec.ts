import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

const SHOTS = 'output/playwright/B549';

async function openVacancies(page: Page): Promise<void> {
  await mockSignedInCabinet(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.click();
  await expect(page.locator('.vac-list-item').first()).toBeVisible({ timeout: 15_000 });
}

async function expandFirst(page: Page) {
  const item = page.locator('.vac-list-item').first();
  const trigger = item.locator('.vacancies-screen-row-trigger');
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return item;
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test('B549 1440: requirement chips, company path in the row, sectioned description', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', 'desktop expanded row');
  await openVacancies(page);
  const item = await expandFirst(page);
  const detail = item.locator('.vac-detail');
  await expect(detail.getByRole('heading', { name: 'Требования к навыкам' })).toBeVisible();
  await expect(detail).toContainText('Из описания вакансии и тегов источника');
  await shot(page, 'app-1440-frame');

  await detail.getByRole('button', { name: 'Путь к компании', exact: true }).click();
  const panel = detail.locator('.vacancy-path-panel');
  await expect(
    panel.getByRole('heading', { name: 'Как откликнуться: три круга связей' }),
  ).toBeVisible();
  await expect(panel.locator('.vacancy-path-circle')).toHaveCount(3);
  await expect(panel).toContainText('Круг 3');
  await expect(page.getByRole('tab', { name: /Компании и люди/u })).not.toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shot(page, 'app-1440-put');

  await detail.getByRole('button', { name: 'Полное описание', exact: true }).click();
  const footer = page.locator('.vacancies-info-footer');
  await expect(footer.getByRole('button', { name: 'Закрыть' })).toBeVisible();
  await expect(page.locator('.vacancies-info-body')).not.toContainText('Кто нанимает');
  await expect(page.locator('.vacancies-info-subtitle')).toContainText('полный текст вакансии');
  await shot(page, 'app-1440-desc');
  await footer.getByRole('button', { name: 'Закрыть' }).click();
  await expect(footer).toHaveCount(0);
});

test('B549 390: row → «Вакансия» → «Путь к компании» → «Круг 3» and back', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'mobile push screens');
  await openVacancies(page);
  await expandFirst(page);
  const push = page.locator('.vacancy-push');
  const title = push.locator('#vacancy-push-title');
  await expect(title).toHaveText('Вакансия');
  await expect(push).toContainText('Совпадение с вашими условиями');
  await shot(page, 'app-390m-job');

  await push.getByRole('button', { name: /Путь к компании/u }).click();
  await expect(title).toHaveText('Путь к компании');
  await expect(push.locator('.vacancy-push-circle')).toHaveCount(3);
  await shot(page, 'app-390m-path');

  await push.getByRole('button', { name: /Холодный отклик/u }).click();
  await expect(title).toHaveText('Круг 3');
  await expect(push).toContainText('Что отправится');
  await expect(push.getByRole('button', { name: 'Подготовить письмо' })).toBeVisible();
  await shot(page, 'app-390m-c3');

  await push.getByRole('button', { name: 'Назад' }).click();
  await expect(title).toHaveText('Путь к компании');
  await push.getByRole('button', { name: 'Назад' }).click();
  await expect(title).toHaveText('Вакансия');
  await push.getByRole('button', { name: 'Назад' }).click();
  await expect(push).toHaveCount(0);
});

test('B549 «Обсудить» opens the consultant with the vacancy question', async ({
  page,
}, testInfo) => {
  await openVacancies(page);
  const item = await expandFirst(page);
  if (testInfo.project.name === 'mobile-390') {
    await page
      .locator('.vacancy-push')
      .getByRole('button', { name: /Обсудить с консультантом/u })
      .click();
  } else {
    await item
      .locator('.vacancies-screen-detail-actions')
      .getByRole('button', { name: 'Обсудить', exact: true })
      .click();
  }
  await expect(page.locator('#career-expert-input')).toBeVisible();
  await expect(page.locator('#career-expert-input')).toHaveValue(/^Почему «.+» подходит\?/u);
  await shot(page, `app-discuss-${testInfo.project.name}`);
});
