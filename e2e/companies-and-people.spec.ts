import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { mockCompanyConnectionCircles } from './fixtures/mockCompanyConnectionCircles';

type MockOptions = NonNullable<Parameters<typeof mockSignedInCabinet>[1]>;

async function showCompanyScreen(
  page: import('@playwright/test').Page,
  expectedCount = '400 компаний в текущей подборке',
) {
  await visitCompanyTab(page);
  await expect(page.getByText(expectedCount)).toBeVisible();
}

async function visitCompanyTab(page: import('@playwright/test').Page) {
  await navigateToVacanciesSection(page);
  await page.getByRole('tab', { name: /Компании и люди/u }).click();
  await expect(page.locator('.companies-and-people')).toBeVisible();
}

async function navigateToVacanciesSection(page: import('@playwright/test').Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Компании и люди/u })).toBeVisible();
}

async function openCompanyScreen(
  page: import('@playwright/test').Page,
  options: MockOptions = {},
  expectedCount?: string,
) {
  await mockSignedInCabinet(page, options);
  await showCompanyScreen(page, expectedCount);
}

async function openCompany(page: import('@playwright/test').Page, companyName: string) {
  await page.getByRole('button', { name: `Открыть компанию ${companyName}` }).click();
}

async function captureCompanyState(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  name: string,
) {
  const view = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  const directory = 'test-results/evidence/AUD-13';
  mkdirSync(directory, { recursive: true });
  const stem = `${directory}/${name}-${view}`;
  await page.screenshot({ path: `${stem}.png`, fullPage: true });
  await writeFile(`${stem}.html`, await page.content());
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectCompanyTouchTargets(page: import('@playwright/test').Page) {
  const tooSmall = await page
    .locator(
      '.companies-and-people button, .companies-and-people a[href], .companies-and-people select, .companies-people-search, .companies-people-filter-option',
    )
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || rect.height >= 44) return [];
        return [
          `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}: ${rect.height}`,
        ];
      }),
    );
  expect(tooSmall).toEqual([]);
}

async function focusWithKeyboard(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<void> {
  const target = page.locator(selector);
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error('Search field not reachable by keyboard.');
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
  await captureCompanyState(page, testInfo, 'companies-list');

  await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();
  await expect(page.getByRole('heading', { name: 'Вектор Банк' })).toBeVisible();
  await expect(page.getByText('Мария Орлова')).toBeVisible();
  await expect(page.getByText(/Объявление вакансии/u).first()).toBeVisible();
  await expectCompanyScreenAccessible(page);
  await captureCompanyState(page, testInfo, 'company-detail');

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

test('adds a company to Wants from its row and keeps it after reload', async ({ page }) => {
  await openCompanyScreen(page, { companyDirectory: { wantedCompanyCount: 0 } });
  const want = page.getByRole('button', { name: 'Добавить', exact: true }).first();
  await want.click();
  await expect(page.getByRole('button', { name: 'Хочу', exact: true }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await navigateToVacanciesSection(page);
  await page.getByRole('tab', { name: /Компании и люди/u }).click();
  if (page.viewportSize()?.width === 390) {
    await page.getByRole('button', { name: 'Фильтры' }).click();
    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await sheet.getByRole('radio', { name: 'Хочу', exact: true }).check();
    await expect(sheet.getByRole('button', { name: 'Показать 1', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Хочу 1', exact: true })).toBeVisible();
  }
});

test('sorts companies and filters the list by a typed name', async ({ page }, testInfo) => {
  await openCompanyScreen(page);
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Фильтры' }).click();
    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await sheet.getByRole('radio', { name: 'По алфавиту', exact: true }).check();
    await sheet.getByRole('button', { name: 'Показать 400', exact: true }).click();
  } else {
    await page.getByRole('combobox', { name: 'Сортировка компаний' }).selectOption('alphabetical');
  }
  await expect(
    page.getByRole('button', { name: 'Открыть компанию Арка Холдинг' }).first(),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Поиск среди компаний' }).fill('Гринкод');
  await expect(page.getByText('1 компания в текущей подборке')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть компанию Гринкод' })).toBeVisible();
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
  await captureCompanyState(page, testInfo, 'company-filter-sheet');
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
  await page.getByText(/Чтобы найти, кто ведёт вакансию/u).scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'recruiter-search-consent');
  await page.getByRole('button', { name: 'Разрешить и найти' }).click();
  const queueStatus = page.getByRole('status').filter({ hasText: 'Поиск рекрутёра выполняется' });
  await expect(queueStatus).toBeVisible();
  await queueStatus.scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'recruiter-search-queued');
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
  await page
    .getByText('Контакты в вашей сети неизвестны: LinkedIn не подключён.')
    .scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-no-linkedin');
  await page.getByRole('button', { name: 'Подключить LinkedIn' }).click();
  const account = page.getByTestId('career-shell').getByRole('main');
  if (testInfo.project.name === 'mobile-390') {
    await expect(account.getByRole('heading', { name: 'Подключения' })).toBeVisible();
  } else {
    await expect(account.getByRole('tab', { name: /Подключения/u })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
});

test('the company screen has no page overflow at narrow phone widths', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-390',
    'The narrow phone audit uses the mobile layout.',
  );
  await openCompanyScreen(page);
  const search = page.getByRole('textbox', { name: 'Поиск среди компаний' });
  await focusWithKeyboard(page, '.companies-people-search input');
  await expect(search).toBeFocused();
  const focusStyle = await search.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), outline: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ visible: true, outline: '2px' });
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expectCompanyTouchTargets(page);
  }
  await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expectCompanyTouchTargets(page);
  }
  await page.getByRole('button', { name: 'Назад к компаниям' }).click();
  await page.getByRole('button', { name: 'Фильтры' }).click();
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expectCompanyTouchTargets(page);
  }
});

test('empty selection links back to Career', async ({ page }, testInfo) => {
  await openCompanyScreen(page, { companyCount: 0 }, '0 компаний в текущей подборке');
  await expect(page.getByText(/подборка вакансий пуста/u)).toBeVisible();
  await captureCompanyState(page, testInfo, 'company-empty-selection');
  await page.getByRole('button', { name: 'Открыть «Карьеру»' }).click();
  await expect(page.locator('.career-screen')).toBeVisible();
});

test('empty Wants state explains that bulk add is not connected', async ({ page }, testInfo) => {
  await openCompanyScreen(page, { companyDirectory: { wantedCompanyCount: 0 } });
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Фильтры' }).click();
    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await sheet.getByRole('radio', { name: 'Хочу', exact: true }).check();
    await sheet.getByRole('button', { name: 'Показать 0', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Хочу 0', exact: true }).click();
  }
  await expect(page.getByText('В «Хочу» пока нет компаний.')).toBeVisible();
  await expect(
    page.getByText('Массовое добавление всех компаний пока не подключено.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Все компании подборки в «Хочу»/u }),
  ).toBeDisabled();
  await captureCompanyState(page, testInfo, 'company-empty-want');
});

test('stale contact import is dated and opens connection settings', async ({ page }, testInfo) => {
  await openCompanyScreen(page, {
    companyDirectory: {
      contactImport: {
        companyName: 'Вектор Банк',
        count: 0,
        importedAt: '2026-09-12T10:00:00.000Z',
      },
    },
  });
  await openCompany(page, 'Вектор Банк');
  const staleNotice = page.getByText(/Импорт контактов устарел.*12\.09\.2026/u);
  await expect(staleNotice).toBeVisible();
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Фильтры' }).click();
    const filters = page.getByRole('dialog', { name: 'Фильтры' });
    await expect(filters.getByRole('radio', { name: 'Есть контакты · неизвестно' })).toBeDisabled();
    await filters.getByRole('button', { name: 'Закрыть' }).click();
  } else {
    await expect(page.getByRole('button', { name: 'Есть контакты · неизвестно' })).toBeDisabled();
  }
  await staleNotice.scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-stale-import');
  await page.getByRole('button', { name: 'Открыть подключения' }).click();
  if (testInfo.project.name === 'mobile-390') {
    await expect(page.getByRole('heading', { name: 'Подключения' })).toBeVisible();
  } else {
    await expect(page.getByRole('tab', { name: /Подключения/u })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  }
});

test('a recruiter hypothesis shows its public source and date', async ({ page }, testInfo) => {
  await mockSignedInCabinet(page, {
    companyDirectory: { recruiterSearch: { companyName: 'Гринкод', outcome: 'found' } },
  });
  await mockCompanyConnectionCircles(page);
  await showCompanyScreen(page);
  await page.getByRole('textbox', { name: 'Поиск среди компаний' }).fill('Гринкод');
  await openCompany(page, 'Гринкод');
  await expect(page.getByText('Елена Миронова')).toBeVisible();
  await expect(
    page.getByText('Предположение по должности и компании: проверьте профиль.').first(),
  ).toBeVisible();
  await expect(page.getByText(/Публичный профиль LinkedIn · 08\.10\.2026/u).first()).toBeVisible();
  await page.getByText('Елена Миронова').first().scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-recruiter-found');
  await page.getByRole('button', { name: 'Подготовить сообщение' }).first().click();
  await expect(page.getByRole('region', { name: 'Сообщение нанимающему' })).toContainText(
    'Текст для знакомства.',
  );
});

test('a completed recruiter search can report no result without claiming the recruiter does not exist', async ({
  page,
}, testInfo) => {
  await openCompanyScreen(page, {
    companyDirectory: { recruiterSearch: { companyName: 'Гринкод', outcome: 'not-found' } },
  });
  await page.getByRole('textbox', { name: 'Поиск среди компаний' }).fill('Гринкод');
  await openCompany(page, 'Гринкод');
  const notFound = page.getByText(
    'Рекрутер не найден в объявлениях вакансий и публичных профилях.',
  );
  await expect(notFound).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить поиск' })).toBeEnabled();
  await notFound.scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-recruiter-not-found');
});

test('company directory exposes its loading state before results arrive', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page);
  await navigateToVacanciesSection(page);
  await page.route('**/api/v1/candidate/companies**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fallback();
  });
  await page.getByRole('tab', { name: /Компании и люди/u }).click();
  await expect(page.getByRole('status')).toContainText('Загружаем компании текущей подборки');
  await page.getByRole('status').scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-loading');
  await expect(page.getByText('400 компаний в текущей подборке')).toBeVisible();
});

test('company directory can retry a failed list request', async ({ page }, testInfo) => {
  await mockSignedInCabinet(page);
  await navigateToVacanciesSection(page);
  let attempts = 0;
  await page.route('**/api/v1/candidate/companies**', async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { error: { code: 'temporary', message: 'Каталог компаний временно недоступен.' } },
      });
      return;
    }
    await route.fallback();
  });
  await page.getByRole('tab', { name: /Компании и люди/u }).click();
  await expect(page.getByRole('alert')).toContainText('Каталог компаний временно недоступен.');
  await page.getByRole('alert').scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-list-error');
  await page.getByRole('button', { name: 'Повторить' }).click();
  await expect(page.getByText('400 компаний в текущей подборке')).toBeVisible();
});

test('shows company connection circles and opens the letter in the selected circle', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page);
  await mockCompanyConnectionCircles(page);
  await showCompanyScreen(page);
  await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();

  const circles = page.getByRole('region', { name: 'Связи с людьми компании' });
  await expect(circles.getByText('Дмитрий Козлов')).toBeVisible();
  await expect(circles.getByText('Знаком с вашим контактом Игорем Н.')).toBeVisible();
  await circles.scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-connection-circles');
  await circles.getByRole('button', { name: 'Попросить представить' }).click();

  await expect(page.getByRole('heading', { name: 'Письмо под вакансию' })).toBeVisible();
  await page.getByRole('tab', { name: 'Круг 2' }).scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-letter-circle-2');
  await expect(page.getByRole('tab', { name: 'Круг 2' })).toHaveAttribute('aria-selected', 'true');
});
