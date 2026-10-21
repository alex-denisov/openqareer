import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

async function navigateToVacancies(page: Page) {
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.click();
  await page.mouse.move(1, 1);
  await page.mouse.click(1, 1);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await expect(page.locator('.vacancies-screen')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Подборка/u })).toBeVisible();
  await expect(page.locator('.vac-list-item').first()).toBeVisible({ timeout: 15_000 });
}

async function openVacancies(page: Page) {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await navigateToVacancies(page);
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
        ].filter((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
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
  const factsPath = `output/playwright/B446/B446-responsive-facts-${testInfo.project.name}.json`;
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
  const mobileToggle = page.getByRole('button', { name: 'Фильтры' });
  if (await mobileToggle.isVisible()) {
    await mobileToggle.click();
    return;
  }
  await page.locator('[data-filter-group="locations"]').click();
}

test('B446: filter a vacancy, save it, set company want, and keep it after reload', async ({
  page,
}, testInfo) => {
  await mockSignedInCabinet(page, {
    vacancyTotal: 148,
    vacancyFacets: {
      total: 148,
      regions: [],
      remote: 74,
      levels: [],
      roles: [
        { role: 'Head', count: 12 },
        { role: 'Director', count: 8 },
      ],
      sources: [
        { sourceId: 'hh', name: 'hh.ru', count: 74 },
        { sourceId: 'linkedin', name: 'LinkedIn', count: 74 },
      ],
    },
    vacancyInitialFilters: {
      roles: ['Head', 'Director'],
      regions: [],
      levels: [],
      sources: ['hh', 'linkedin'],
      remoteOnly: false,
      selectedLocations: [
        'Москва',
        ...Array.from({ length: 46 }, (_, index) => `Город ${index + 1}`),
      ],
      salaryMinimum: 450_000,
      salaryCurrency: '₽',
      formats: ['hybrid', 'remote'],
    },
    savedVacanciesCount: 18,
    companyCount: 61,
  });
  await openVacancies(page);
  const shell = page.locator('.career-shell');
  await expect(shell).toHaveClass(/career-shell--vacancies/u);
  await expect(shell.locator('.career-expert-peek')).toHaveCount(0);
  await expect(page.locator('.path-strip')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Подборка 148' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Сохранённые 18' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Компании и люди 61' })).toBeVisible();
  await expect(page.locator('.vacancies-filter-toolbar')).toBeVisible();
  if (testInfo.project.name === 'desktop-1440') {
    const expectedFilterSummaries = [
      ['roles', 'Head, Director'],
      ['locations', 'Москва +46'],
      ['salary', 'от 450 тыс. ₽'],
      ['format', '2'],
      ['sources', '2'],
    ] as const;
    for (const [group, summary] of expectedFilterSummaries) {
      const trigger = page.locator(`[data-filter-group="${group}"]`);
      await expect(trigger).toBeVisible();
      await expect(trigger).toContainText(summary);
    }
  } else {
    await expect(page.getByRole('button', { name: 'Фильтры' })).toBeVisible();
    const chips = page.getByRole('group', { name: 'Выбранные фильтры' });
    for (const summary of ['Head, Director', 'Москва +46', 'от 450 тыс. ₽', '2']) {
      await expect(chips).toContainText(summary);
    }
  }
  if (testInfo.project.name === 'desktop-1440') {
    await expect(shell.locator('.career-expert-panel')).toBeVisible();
  } else {
    await expect(shell.locator('.career-topbar')).toHaveCount(0);
    await expect(page.locator('.vacancies-mobile-topbar')).toBeVisible();
    await page.getByRole('button', { name: 'Уведомления' }).click();
    await expect(page.getByRole('heading', { name: 'Уведомления' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Разделы' })
      .getByRole('button', { name: 'Вакансии' })
      .click();
    await expect(shell.getByRole('main').getByRole('heading', { name: 'Вакансии' })).toBeVisible();
    await page.getByRole('button', { name: 'Спросить консультанта' }).click();
    await expect(shell.locator('.career-expert-panel')).toBeVisible();
    await shell
      .locator('.career-expert-panel')
      .getByRole('button', { name: 'Развернуть или свернуть консультанта' })
      .last()
      .click();
    await expect(page.locator('.career-expert-panel')).not.toBeVisible();
  }
  const viewportSuffix = testInfo.project.name === 'mobile-390' ? '390' : '1440';
  mkdirSync('output/playwright/B446', { recursive: true });
  await measureResponsiveWidths(page, testInfo);
  await page.screenshot({
    path: `output/playwright/B446/B446-home-${viewportSuffix}.png`,
    fullPage: true,
  });
  await openFilters(page);
  await page.screenshot({
    path: `output/playwright/B446/B446-filters-${viewportSuffix}.png`,
    fullPage: true,
  });
  if (testInfo.project.name === 'mobile-390') {
    const mobileSheet = page.locator('.vacancies-filters.is-mobile-open');
    await expect(
      mobileSheet.getByRole('searchbox', { name: 'Страна, регион, штат или город' }),
    ).toBeVisible();
    await expect(
      mobileSheet.locator('.vacancy-salary-filter input[type="number"]').first(),
    ).toHaveValue('450000');
    await expect(mobileSheet.locator('.vacancy-format-filter')).toBeVisible();
    await expect(mobileSheet.locator('.vacancy-source-filter')).toBeVisible();
    await expect(mobileSheet.locator('[data-filter-sheet-group]')).toHaveCount(0);
    await expect(mobileSheet.getByRole('button', { name: 'Сбросить' })).toBeVisible();
    await expect(mobileSheet.getByRole('button', { name: 'Показать результаты' })).toBeVisible();
  }
  if (testInfo.project.name === 'desktop-1440') {
    await page.locator('.vacancies-summary-reset').click();
  } else {
    await page.locator('.vacancies-sheet-reset').click();
  }

  const locationSearch = page.getByRole('searchbox', {
    name: 'Страна, регион, штат или город',
  });
  await locationSearch.fill('Berlin');
  const screenError = page.locator('.career-error-boundary-details code');
  if (await screenError.count())
    throw new Error((await screenError.textContent()) ?? 'Unknown screen error');
  await page
    .getByRole('button', {
      name: testInfo.project.name === 'mobile-390' ? 'Показать результаты' : 'Применить',
    })
    .click();
  await expect(page.locator('.vacancies-filters')).toBeHidden();
  await page.screenshot({
    path: `output/playwright/B446/B446-filtered-${viewportSuffix}.png`,
    fullPage: true,
  });

  const vacancy = page
    .locator('.vac-list-item')
    .filter({ hasText: 'Product Lead, Merchant Onboarding' })
    .filter({ hasText: 'Revolut' })
    .first();
  await expect(vacancy).toBeVisible({ timeout: 15_000 });
  const saveButton = vacancy
    .locator('.vacancies-screen-row-shell')
    .getByRole('button', { name: 'Сохранить', exact: true });
  await expect(saveButton).toBeVisible();
  const actionHeights = await vacancy
    .locator('.career-vacancy-actions button')
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => button.getBoundingClientRect().height),
    );
  expect(actionHeights.every((height) => height >= 44)).toBe(true);
  const rowTrigger = vacancy.locator('.vacancies-screen-row-trigger');
  if (testInfo.project.name === 'mobile-390') {
    await wantAndPathOnPush(page, rowTrigger, viewportSuffix);
  } else {
    if ((await rowTrigger.getAttribute('aria-expanded')) !== 'true') await rowTrigger.click();
    const companyWantButton = vacancy
      .locator('.vacancies-screen-detail-actions')
      .getByRole('button', { name: 'Хочу в эту компанию' });
    await expect(companyWantButton).toBeVisible();
    await companyWantButton.click();
    await expect(
      vacancy.locator('.vacancies-screen-detail-actions').getByRole('button', {
        name: 'Убрать из «Хочу»',
      }),
    ).toBeVisible();
    await page.screenshot({
      path: `output/playwright/B446/B446-company-want-${viewportSuffix}.png`,
      fullPage: true,
    });
    if ((await rowTrigger.getAttribute('aria-expanded')) !== 'true') await rowTrigger.click();
    const companyPathButton = vacancy.getByRole('button', { name: /Путь к компании/u });
    await focusWithKeyboard(page, companyPathButton);
    await page.keyboard.press('Enter');
    // B549: the circles open inside the row; the people tab is one step further.
    await focusWithKeyboard(
      page,
      vacancy
        .locator('.vacancy-path-panel')
        .getByRole('button', { name: 'Добавить контакты' })
        .first(),
    );
    await page.keyboard.press('Enter');
  }
  await expect(page.getByRole('tab', { name: /Компании и люди/u })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Revolut' })).toBeVisible();
  await page.screenshot({
    path: `output/playwright/B446/B446-company-path-${viewportSuffix}.png`,
    fullPage: true,
  });
  await page.getByRole('tab', { name: /Подборка/u }).click();
  await focusWithKeyboard(page, saveButton);
  await page.keyboard.press('Space');
  await expect(page.getByRole('tab', { name: 'Сохранённые 19' })).toBeVisible();

  await page.getByRole('tab', { name: 'Сохранённые 19' }).click();
  const savedSearch = page.getByRole('searchbox', {
    name: 'Компания или роль среди 19 сохранённых',
  });
  await savedSearch.fill('Merchant Onboarding');
  await expect(
    page.getByRole('heading', { name: 'Product Lead, Merchant Onboarding' }),
  ).toBeVisible();
  await page.screenshot({
    path: `output/playwright/B446/B446-saved-${viewportSuffix}.png`,
    fullPage: true,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await navigateToVacancies(page);
  await openFilters(page);
  if (testInfo.project.name === 'desktop-1440') {
    await page.locator('.vacancies-summary-reset').click();
  } else {
    await page.locator('.vacancies-sheet-reset').click();
  }
  await page.getByRole('searchbox', { name: 'Страна, регион, штат или город' }).fill('Berlin');
  await page
    .getByRole('button', {
      name: testInfo.project.name === 'mobile-390' ? 'Показать результаты' : 'Применить',
    })
    .click();
  const reloadedVacancy = page
    .locator('.vac-list-item')
    .filter({ hasText: 'Product Lead, Merchant Onboarding' })
    .filter({ hasText: 'Revolut' })
    .first();
  await expect(reloadedVacancy).toBeVisible({ timeout: 15_000 });
  const reloadedRowTrigger = reloadedVacancy.locator('.vacancies-screen-row-trigger');
  if ((await reloadedRowTrigger.getAttribute('aria-expanded')) !== 'true')
    await reloadedRowTrigger.click();
  // B549: at 390 the actions live on the «Вакансия» push screen.
  const actions =
    testInfo.project.name === 'mobile-390'
      ? page.locator('.vacancy-push')
      : reloadedVacancy.locator('.vacancies-screen-detail-actions');
  const removeCompanyWant = actions.getByRole('button', { name: /Убрать из «Хочу»/u });
  await expect(removeCompanyWant).toBeVisible();
  await removeCompanyWant.click();
  const restoredWantAction = actions.getByRole('button', { name: /Хочу в эту компанию/u });
  await expect(restoredWantAction).toBeVisible();
  if (testInfo.project.name === 'mobile-390') {
    await page.locator('.vacancy-push').getByRole('button', { name: 'Назад' }).click();
  }
  await expect(page.getByRole('tab', { name: 'Сохранённые 19' })).toBeVisible();
  await page.getByRole('tab', { name: 'Сохранённые 19' }).click();
  await expect(
    page.getByRole('heading', { name: 'Product Lead, Merchant Onboarding' }),
  ).toBeVisible();
  await page.screenshot({
    path: `output/playwright/B446/B446-saved-after-reload-${viewportSuffix}.png`,
    fullPage: true,
  });
});

/** B549: at 390 the row opens the «Вакансия» push screen with the same actions. */
async function wantAndPathOnPush(page: Page, rowTrigger: Locator, viewportSuffix: string) {
  await rowTrigger.click();
  const push = page.locator('.vacancy-push');
  await push.getByRole('button', { name: /Хочу в эту компанию/u }).click();
  await expect(push.getByRole('button', { name: /Убрать из «Хочу»/u })).toBeVisible();
  await page.screenshot({
    path: `output/playwright/B446/B446-company-want-${viewportSuffix}.png`,
    fullPage: true,
  });
  await push.getByRole('button', { name: /Путь к компании/u }).click();
  await push.locator('.vacancy-push-circle').first().click();
}
