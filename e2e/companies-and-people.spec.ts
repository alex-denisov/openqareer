import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

async function showCompanyScreen(page: import('@playwright/test').Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await page.getByRole('tab', { name: /Компании и люди/u }).click();
  await expect(page.getByText('400 компаний в текущей подборке')).toBeVisible();
}

async function openCompanyScreen(page: import('@playwright/test').Page) {
  await mockSignedInCabinet(page);
  await showCompanyScreen(page);
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectCompanyScreenAccessible(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).include('.companies-and-people').analyze();
  expect(
    results.violations
      .filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))
      .map((violation) => ({
        id: violation.id,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: node.target,
          html: node.html,
          summary: node.failureSummary,
        })),
      })),
  ).toEqual([]);
}

test('pages 400 companies and opens a source-backed company detail', async ({ page }, testInfo) => {
  await openCompanyScreen(page);
  const rows = page.getByRole('list', { name: 'Компании текущей подборки' }).getByRole('listitem');
  await expect(rows).toHaveCount(20);
  await expect(page.getByText('Контакты в сети: неизвестно').first()).toBeVisible();
  await expectCompanyScreenAccessible(page);
  const body = await page.locator('.companies-and-people').innerText();
  expect(body).not.toMatch(/linkedin_pool|pool_session|account pool|узлы/iu);
  await page.screenshot({ path: testInfo.outputPath('B439-companies-list.png'), fullPage: true });

  await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();
  await expect(page.getByRole('heading', { name: 'Вектор Банк' })).toBeVisible();
  await expect(page.getByText('Мария Орлова')).toBeVisible();
  await expect(page.getByText(/Объявление вакансии/u).first()).toBeVisible();
  await expectCompanyScreenAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('B439-company-people.png'), fullPage: true });

  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Назад к компаниям' }).click();
  }
  await page.getByRole('button', { name: 'Показать ещё 20' }).click();
  await expect(rows).toHaveCount(40);
});

test('stores a wanted company next step and removes the want', async ({ page }) => {
  await openCompanyScreen(page);
  await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();
  await page.getByRole('button', { name: 'Добавить шаг' }).click();
  await page.getByLabel('Следующий шаг').fill('Написать Марии Орловой');
  await page.getByLabel('Дата').fill('2026-10-10');
  await page.getByRole('button', { name: 'Сохранить шаг' }).click();
  await expect(
    page.getByText('Следующий шаг: Написать Марии Орловой, до 10.10.2026'),
  ).toBeVisible();

  await showCompanyScreen(page);
  await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();
  await expect(
    page.getByText('Следующий шаг: Написать Марии Орловой, до 10.10.2026'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Убрать' }).click();
  await expect(page.getByRole('button', { name: 'Хочу в эту компанию' })).toBeVisible();
});

test('the mobile filter sheet marks network-contact counts as unknown', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The approved filters sheet is mobile-only.');
  await openCompanyScreen(page);
  await page.getByRole('button', { name: 'Фильтры' }).click();
  const dialog = page.getByRole('dialog', { name: 'Фильтры' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Есть контакты · неизвестно' })).toBeDisabled();
  await expectCompanyScreenAccessible(page);
  await page.screenshot({ path: testInfo.outputPath('B439-company-filters.png'), fullPage: true });
  await dialog.getByRole('radio', { name: 'Хочу', exact: true }).check();
  await dialog.getByRole('button', { name: /Показать/u }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('3 компании в текущей подборке')).toBeVisible();
});

test('recruiter lookup asks for consent and shows an honest queued state', async ({
  page,
}, testInfo) => {
  await openCompanyScreen(page);
  await page.getByRole('textbox', { name: 'Поиск среди компаний' }).fill('Гринкод');
  await page.getByRole('button', { name: 'Открыть компанию Гринкод' }).click();
  await expect(
    page.getByText(
      'Чтобы найти, кто ведёт вакансию, включите режим «Вы в поиске»: мы будем искать контакты нанимающих по вашим вакансиям.',
    ),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('B439-company-no-recruiter.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Разрешить и найти' }).click();
  await expect(page.getByRole('status')).toContainText('Поиск рекрутёра выполняется');
  await page.screenshot({
    path: testInfo.outputPath('B439-company-search-queued.png'),
    fullPage: true,
  });
});

test('a company without LinkedIn keeps network contacts unknown and opens connection settings', async ({
  page,
}, testInfo) => {
  await openCompanyScreen(page);
  await page.getByRole('button', { name: 'Открыть компанию Арка Холдинг' }).click();
  await expect(
    page.getByText('Контакты в вашей сети неизвестны: LinkedIn не подключён.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подключить LinkedIn' })).toBeEnabled();
  await expectCompanyScreenAccessible(page);
  await page.screenshot({
    path: testInfo.outputPath('B439-company-no-linkedin.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Подключить LinkedIn' }).click();
  const account = page.getByRole('dialog', { name: 'Аккаунт' });
  await expect(
    account
      .getByRole('navigation', { name: 'Настройки аккаунта' })
      .getByRole('button', { name: 'Подключения' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('the company screen has no page overflow at narrow phone widths', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-390',
    'The narrow phone audit uses the mobile layout.',
  );
  await openCompanyScreen(page);
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: 'Назад к компаниям' }).click();
  await page.getByRole('button', { name: 'Фильтры' }).click();
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
  }
});
