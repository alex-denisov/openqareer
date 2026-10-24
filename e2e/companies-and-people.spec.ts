import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { mockCompanyConnectionCircles } from './fixtures/mockCompanyConnectionCircles';

type MockOptions = NonNullable<Parameters<typeof mockSignedInCabinet>[1]>;

async function showCompanyScreen(
  page: import('@playwright/test').Page,
  expectedCount = '400 компаний в подборке',
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
        // Mockup 13 pills draw 32 px and take the rest of the 44 px target through ::after.
        const after = window.getComputedStyle(element, '::after');
        const extra =
          after.content !== 'none' && after.position === 'absolute'
            ? -(parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0)
            : 0;
        const height = rect.height + extra;
        if (rect.width === 0 || rect.height === 0 || height >= 44) return [];
        return [
          `${element.tagName.toLowerCase()}.${String(element.className).split(' ')[0]}: ${height}`,
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
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toHaveCount(0);
  if (testInfo.project.name !== 'mobile-390') {
    await expect(page.getByRole('button', { name: /^Все \d+$/u })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Хочу 3', exact: true })).toBeVisible();
  }
  await expectCompanyScreenAccessible(page);
  const body = await page.locator('.companies-and-people').innerText();
  expect(body).not.toMatch(/linkedin_pool|pool_session|account pool|узлы/iu);
  await captureCompanyState(page, testInfo, 'companies-list');

  await page.getByRole('button', { name: 'Открыть компанию Вектор Банк' }).click();
  await expect(page.getByRole('heading', { name: 'Вектор Банк' })).toBeVisible();
  await expect(page.getByText('Москва · Финансы · данные с hh.ru, 08.10.2026')).toBeVisible();
  await expect(page.getByText(/Рекрутер Мария Орлова взят из объявления/u)).toBeVisible();
  const mobile = testInfo.project.name === 'mobile-390';
  await expect(
    page.locator(mobile ? '[data-company-vacancy]' : '.companies-people-vacancy'),
  ).toHaveCount(3);
  if (mobile) await expect(page.getByRole('heading', { name: 'Компания' })).toBeVisible();
  await expectCompanyScreenAccessible(page);
  await captureCompanyState(page, testInfo, 'company-detail');

  if (mobile) {
    await page.getByRole('button', { name: 'Назад', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Показать ещё 20' }).click();
  await expect(rows).toHaveCount(40);
});

test('«Хочу в эту компанию» and «Убрать» survive a reload', async ({ page }) => {
  await openCompanyScreen(page);
  await page.getByRole('textbox', { name: 'Поиск среди 400' }).fill('Гринкод');
  await openCompany(page, 'Гринкод');
  await page.getByRole('button', { name: 'Хочу в эту компанию' }).click();
  await expect(page.getByRole('button', { name: 'Убрать' })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await showCompanyScreen(page);
  await page.getByRole('textbox', { name: 'Поиск среди 400' }).fill('Гринкод');
  await openCompany(page, 'Гринкод');
  await expect(page.getByText('Хочу в эту компанию', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Убрать' }).click();
  await expect(page.getByRole('button', { name: 'Хочу в эту компанию' })).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await showCompanyScreen(page);
  await page.getByRole('textbox', { name: 'Поиск среди 400' }).fill('Гринкод');
  await openCompany(page, 'Гринкод');
  await expect(page.getByRole('button', { name: 'Хочу в эту компанию' })).toBeVisible();
});

test('a pressed filter chip filters and a second press clears it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390', 'Chips live in the filter sheet on 390.');
  await openCompanyScreen(page);
  await page.getByRole('button', { name: 'Хочу 3', exact: true }).click();
  await expect(page.getByText('3 компании в подборке')).toBeAttached();
  await page.getByRole('button', { name: 'Хочу 3', exact: true }).click();
  await expect(page.getByText('400 компаний в подборке')).toBeAttached();
});

test('«Все N вакансий компании в подборке» opens the selection filtered by the company', async ({
  page,
}) => {
  await openCompanyScreen(page);
  await openCompany(page, 'Вектор Банк');
  await page.getByRole('button', { name: /^Все 12 вакансий компании/u }).click();
  await expect(page.getByRole('tab', { name: /Подборка/u })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const chip = page.getByRole('button', { name: 'Убрать фильтр компании Вектор Банк' });
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(chip).toBeHidden();
});

test('sorts companies and filters the list by a typed name', async ({ page }, testInfo) => {
  await openCompanyScreen(page);
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Фильтры' }).click();
    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await sheet.getByRole('button', { name: /^Сортировка /u }).click();
    await sheet.getByRole('radio', { name: 'По алфавиту', exact: true }).check();
    await sheet.getByRole('button', { name: 'Показать 400', exact: true }).click();
  } else {
    await page
      .getByRole('combobox', { name: 'Сортировка', exact: true })
      .selectOption('alphabetical');
  }
  await expect(
    page.getByRole('button', { name: 'Открыть компанию Арка Холдинг' }).first(),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Поиск среди 400' }).fill('Гринкод');
  await expect(page.getByText('1 компания в подборке')).toBeVisible();
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
  await dialog.getByRole('button', { name: /^Показывать /u }).click();
  await expect(
    dialog.getByRole('radio', { name: 'Есть контакты в сети · неизвестно' }),
  ).toBeDisabled();
  await expectCompanyScreenAccessible(page);
  await captureCompanyState(page, testInfo, 'company-filter-sheet');
  await dialog.getByRole('radio', { name: /^Хочу \d+$/u }).check();
  await dialog.getByRole('button', { name: /Показать/u }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('3 компании в подборке')).toBeVisible();
});

test('recruiter lookup asks for consent and shows an honest queued state', async ({
  page,
}, testInfo) => {
  await openCompanyScreen(page);
  await page.getByRole('textbox', { name: 'Поиск среди 400' }).fill('Гринкод');
  await page.getByRole('button', { name: 'Открыть компанию Гринкод' }).click();
  await expect(
    page.getByText(
      'Чтобы найти, кто ведёт вакансию, включите режим «Вы в поиске»: мы будем искать контакты нанимающих по вашим вакансиям.',
    ),
  ).toBeVisible();
  await page.getByText(/Чтобы найти, кто ведёт вакансию/u).scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'recruiter-search-consent');
  await page.getByRole('button', { name: 'Разрешить и найти' }).click();
  const queueStatus = page
    .getByRole('status')
    .filter({ hasText: 'Ищем рекрутера по вакансиям компании' });
  await expect(queueStatus).toBeVisible();
  // The refetch after consent remounts the status node; scroll the fresh one.
  await expect(async () => queueStatus.scrollIntoViewIfNeeded({ timeout: 2_000 })).toPass();
  await captureCompanyState(page, testInfo, 'recruiter-search-queued');
});

test('a company without LinkedIn keeps network contacts unknown and opens connection settings', async ({
  page,
}, testInfo) => {
  await openCompanyScreen(page);
  await page.getByRole('button', { name: 'Открыть компанию Арка Холдинг' }).click();
  await expect(
    page.getByText(/Контакты в вашей сети неизвестны: LinkedIn не подключён\./u),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подключить LinkedIn' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Написать рекрутеру' })).toBeVisible();
  await expectCompanyScreenAccessible(page);
  await page
    .getByText(/Контакты в вашей сети неизвестны: LinkedIn не подключён\./u)
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
  const search = page.getByRole('textbox', { name: 'Поиск среди 400' });
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
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('button', { name: 'Фильтры' }).click();
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expectCompanyTouchTargets(page);
  }
});

test('empty selection links back to Career', async ({ page }, testInfo) => {
  await openCompanyScreen(page, { companyCount: 0 }, '0 компаний в подборке');
  await expect(page.getByText(/подборка вакансий пуста/u)).toBeVisible();
  await captureCompanyState(page, testInfo, 'company-empty-selection');
  await page.getByRole('button', { name: 'Открыть «Карьеру»' }).click();
  await expect(page.locator('.career-screen')).toBeVisible();
});

test('empty Wants state adds every selection company after confirmation (B422)', async ({
  page,
}, testInfo) => {
  await openCompanyScreen(page, { companyDirectory: { wantedCompanyCount: 0 } });
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Фильтры' }).click();
    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await sheet.getByRole('button', { name: /^Показывать /u }).click();
    await sheet.getByRole('radio', { name: /^Хочу \d+$/u }).check();
    await sheet.getByRole('button', { name: 'Показать 0', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Хочу 0', exact: true }).click();
  }
  await expect(page.getByText('В «Хочу» пока нет компаний.')).toBeVisible();
  await captureCompanyState(page, testInfo, 'company-empty-want');
  await page.getByRole('button', { name: /Все компании подборки в «Хочу» \(\d+\)/u }).click();
  await expect(page.getByText(/^Добавить \d+ компаний в «Хочу»\?$/u)).toBeVisible();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByText('В «Хочу» пока нет компаний.')).toBeHidden();
});

test('a stale contact import keeps network counts unknown', async ({ page }, testInfo) => {
  await openCompanyScreen(page, {
    companyDirectory: {
      contactImport: {
        companyName: 'Вектор Банк',
        count: 2,
        importedAt: '2026-09-12T10:00:00.000Z',
      },
    },
  });
  if (testInfo.project.name === 'mobile-390') {
    await page.getByRole('button', { name: 'Фильтры' }).click();
    const filters = page.getByRole('dialog', { name: 'Фильтры' });
    await filters.getByRole('button', { name: /^Показывать /u }).click();
    await expect(
      filters.getByRole('radio', { name: 'Есть контакты в сети · неизвестно' }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
  } else {
    await expect(
      page.getByRole('button', { name: 'Есть контакты в сети · неизвестно' }),
    ).toBeDisabled();
  }
  const row = page.getByRole('button', { name: 'Открыть компанию Вектор Банк' });
  await expect(row).toContainText('контакты неизвестны');
});

test('a recruiter hypothesis shows its public source, date and one cold action', async ({
  page,
}, testInfo) => {
  await openCompanyScreen(page, {
    companyDirectory: {
      recruiterSearch: { companyName: 'Гринкод', outcome: 'found' },
      contactImport: {
        companyName: 'Гринкод',
        count: 0,
        importedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
    },
  });
  await page.getByRole('textbox', { name: 'Поиск среди 400' }).fill('Гринкод');
  await openCompany(page, 'Гринкод');
  const people = page.getByRole('region', { name: 'Люди', exact: true });
  await expect(people.getByText('Елена Миронова')).toBeVisible();
  await expect(people.getByText(/Это предположение по должности и компании/u)).toBeVisible();
  await expect(people.getByText(/Контактов в вашей сети нет/u)).toBeVisible();
  await expect(people.getByText(/Публичный профиль LinkedIn, 08\.10\.2026/u).first()).toBeVisible();
  await expect(people.getByText('Круг 3').first()).toBeVisible();
  await people.scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-recruiter-found');
  await page
    .getByRole('button', { name: /^Холодный отклик/u })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Письмо под вакансию' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Круг 3' })).toHaveAttribute('aria-selected', 'true');
});

test('a completed recruiter search can report no result without claiming the recruiter does not exist', async ({
  page,
}, testInfo) => {
  await openCompanyScreen(page, {
    companyDirectory: { recruiterSearch: { companyName: 'Гринкод', outcome: 'not-found' } },
  });
  await page.getByRole('textbox', { name: 'Поиск среди 400' }).fill('Гринкод');
  await openCompany(page, 'Гринкод');
  const notFound = page.getByText(/рекрутера не нашли\. Поиск можно повторить/u);
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
  await expect(page.getByText('400 компаний в подборке')).toBeVisible();
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
  await expect(page.getByText('400 компаний в подборке')).toBeVisible();
});

test('people are cards per person and open the letter in their circle', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page);
  await mockCompanyConnectionCircles(page);
  await showCompanyScreen(page);
  await openCompany(page, 'Вектор Банк');

  const people = page.getByRole('region', { name: 'Люди', exact: true });
  const mobile = testInfo.project.name === 'mobile-390';
  if (mobile) await expect(people.getByRole('button', { name: /Круг [12]/u })).toHaveCount(2);
  else await expect(people.getByRole('article')).toHaveCount(2);
  await expect(people.getByText('Писала вам 28.09')).toBeVisible();
  await expect(people.getByText('Знаком с вашим контактом Дмитрий Козлов')).toBeVisible();
  await expect(people.getByRole('button', { name: 'Холодный отклик' })).toHaveCount(0);
  await expect(page.getByText(/написать Марии Орловой \(круг 1\)/u)).toBeVisible();
  await people.scrollIntoViewIfNeeded();
  await captureCompanyState(page, testInfo, 'company-connection-circles');
  if (mobile) await page.getByRole('button', { name: 'Написать Марии Орловой' }).click();
  else await people.getByRole('button', { name: 'Написать знакомому' }).click();

  await expect(page.getByRole('heading', { name: 'Письмо под вакансию' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Круг 1' })).toHaveAttribute('aria-selected', 'true');
});

test('the consultant proposes a step for a wanted company with a first-circle contact', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390', 'The consultant is a side panel on desktop.');
  await openCompanyScreen(page, {
    companyDirectory: {
      contactImport: {
        companyName: 'Вектор Банк',
        count: 2,
        importedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        people: true,
      },
    },
  });
  const proposal = page.getByRole('region', { name: 'Добавить шаг в «Хочу»' });
  await expect(proposal).toContainText(/Написать Марии Орловой \(Вектор Банк\) до/u);
  await expect(proposal).toContainText('Письмо подготовит консультант, отправите вы.');
  await proposal.getByRole('button', { name: 'Не сейчас' }).click();
  await expect(proposal).toBeHidden();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await showCompanyScreen(page);
  await expect(page.getByRole('region', { name: 'Добавить шаг в «Хочу»' })).toHaveCount(0);
});

test('accepting the consultant proposal stores the company step', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390', 'The consultant is a side panel on desktop.');
  await openCompanyScreen(page, {
    companyDirectory: {
      contactImport: {
        companyName: 'Вектор Банк',
        count: 2,
        importedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        people: true,
      },
    },
  });
  const proposal = page.getByRole('region', { name: 'Добавить шаг в «Хочу»' });
  await proposal.getByRole('button', { name: 'Принять' }).click();
  await expect(proposal).toBeHidden();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await showCompanyScreen(page);
  await openCompany(page, 'Вектор Банк');
  await expect(page.getByText(/Следующий шаг: написать Марии Орловой, до/u)).toBeVisible();
});
