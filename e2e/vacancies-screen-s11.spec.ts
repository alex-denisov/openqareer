import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';

async function openVacancies(page: Page): Promise<void> {
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('button', { name: 'Вакансии', exact: true });
  await expect(navigation).toBeVisible({ timeout: 15_000 });
  await navigation.click();
  await expect(page.locator('.vacancies-screen')).toBeVisible();
  await expect(page.locator('.vac-list-item').first()).toBeVisible({ timeout: 15_000 });
}

async function capture(page: Page, name: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  mkdirSync('output/playwright/S11-VAC', { recursive: true });
  await page.screenshot({
    path: 'output/playwright/S11-VAC/' + name + '-' + width + '.png',
    fullPage: false,
  });
  await page.setViewportSize({ width, height: width > 640 ? 1242 : 1365 });
  await page.screenshot({
    path: 'output/playwright/S11-VAC/' + name + '-full-' + width + '.png',
    fullPage: false,
  });
  await page.setViewportSize({ width, height });
  const markup = await page.evaluate(() => {
    const css = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules, (rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    const root = document.documentElement.cloneNode(true) as HTMLElement;
    root.querySelectorAll('script, link[rel="stylesheet"]').forEach((node) => node.remove());
    const style = document.createElement('style');
    style.textContent = css;
    root.querySelector('head')?.append(style);
    return '<!doctype html>' + root.outerHTML;
  });
  writeFileSync('output/playwright/S11-VAC/' + name + '-' + width + '.html', markup);
}

async function closeFilterPanel(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Свернуть', exact: true });
  if (await close.isVisible()) await close.click();
}

test('S11-VAC: capture all approved vacancy views through the real screen controls', async ({
  page,
}, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-390';
  const width = mobile ? 390 : 1440;
  const viewportHeight = mobile ? 844 : 900;

  await mockSignedInCabinet(page, {
    vacancyTotal: 148,
    vacancyFacets: {
      total: 148,
      regions: [
        { id: 'eu', count: 37 },
        { id: 'mena', count: 12 },
      ],
      remote: 74,
      levels: [
        { level: 'head', count: 20 },
        { level: 'vp', count: 14 },
        { level: 'unknown', count: 8 },
      ],
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
        ...Array.from({ length: 46 }, (_, index) => 'Город ' + String(index + 1)),
      ],
      salaryMinimum: 450_000,
      salaryCurrency: '₽',
      formats: ['hybrid', 'remote'],
    },
    savedVacanciesCount: 18,
    companyCount: 61,
  });
  await page.route('**/api/v1/candidate/vacancies/*/detail', (route) =>
    route.fulfill({
      json: {
        data: {
          id: 'vacancy-detail-fixture',
          description: 'Полное описание вакансии для визуальной проверки.',
          truncated: false,
          skills: ['Operations', 'P&L'],
          responsibilities: ['Управлять продуктом и командой.'],
        },
      },
    }),
  );

  await openVacancies(page);
  await capture(page, 'list', width, viewportHeight);
  if (mobile) {
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
    await expect(page.locator('.vacancies-filters.is-mobile-open')).toBeVisible();
    await expect(page.locator('.vacancies-tabs-row')).toBeHidden();
    await capture(page, 'filters', width, viewportHeight);
    await capture(page, 'roles', width, viewportHeight);
    await closeFilterPanel(page);
  } else {
    await page.locator('[data-filter-group="roles"]').click();
    await expect(page.locator('.vacancies-filters')).toBeVisible();
    await expect(
      page.locator('.vacancies-filters[data-active-group="roles"] .filters-panel-head'),
    ).toBeHidden();
    const premises = page.locator('.career-route-premises');
    await expect(premises).toBeVisible();
    await expect(premises.locator('dl')).toBeHidden();
    await expect(premises.getByRole('button', { name: 'Изменить условия' })).toBeEnabled();
    await capture(page, 'roles', width, viewportHeight);
    await premises.getByRole('button', { name: 'Изменить условия' }).click();
    const premisesEditor = page.locator('.career-route-premises-editor');
    await expect(premisesEditor).toBeVisible();
    await premisesEditor.getByRole('button', { name: 'Отмена' }).click();
    await page.locator('[data-filter-group="locations"]').click();
  }

  const locations = page.locator('.vacancies-filters');
  if (mobile && !(await locations.isVisible())) {
    await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  }
  if (mobile) {
    const locationChip = page.getByRole('button', { name: /Изменить фильтр Локации/u });
    if (await locationChip.isVisible()) await locationChip.click();
  }
  await expect(
    page.getByRole('searchbox', { name: 'Страна, регион, штат или город' }),
  ).toBeVisible();
  await capture(page, 'locations', width, viewportHeight);

  const search = page.getByRole('searchbox', {
    name: 'Страна, регион, штат или город',
  });
  await search.fill('Berlin');
  await capture(page, 'search-location', width, viewportHeight);

  if (mobile) {
    const backToAll = page.getByRole('button', { name: 'Все фильтры', exact: true });
    if (await backToAll.isVisible()) await backToAll.click();
    const sourcesChip = page.getByRole('button', { name: /Изменить фильтр Источники/u });
    if (await sourcesChip.isVisible()) await sourcesChip.click();
  } else {
    await page.locator('[data-filter-group="sources"]').click();
  }
  await expect(page.locator('.vacancy-source-filter')).toBeVisible();
  await capture(page, 'sources', width, viewportHeight);

  if (mobile) {
    const backToAll = page.getByRole('button', { name: 'Все фильтры', exact: true });
    if (await backToAll.isVisible()) await backToAll.click();
    const locationsChip = page.getByRole('button', { name: /Изменить фильтр Локации/u });
    if (await locationsChip.isVisible()) await locationsChip.click();
  } else {
    await page.locator('[data-filter-group="locations"]').click();
  }
  await capture(page, 'countries', width, viewportHeight);

  if (mobile) {
    const backToAll = page.getByRole('button', { name: 'Все фильтры', exact: true });
    if (await backToAll.isVisible()) await backToAll.click();
  }
  await page.locator(mobile ? '.vacancies-sheet-reset' : '.vacancies-summary-reset').click();
  await page.getByRole('searchbox', { name: 'Страна, регион, штат или город' }).fill('Berlin');
  const apply = page.getByRole('button', {
    name: mobile ? 'Показать результаты' : 'Применить',
  });
  await expect(apply).toBeVisible();
  await apply.click();

  const target = page
    .locator('.vac-list-item')
    .filter({ hasText: 'Product Lead, Merchant Onboarding' })
    .filter({ hasText: 'Revolut' })
    .first();
  await expect(target).toBeVisible({ timeout: 15_000 });
  const rowTrigger = target.locator('.vacancies-screen-row-trigger');
  if ((await rowTrigger.getAttribute('aria-expanded')) !== 'true') await rowTrigger.click();

  // B549: at 390 the row opens the «Вакансия» push screen.
  const detailScope = mobile ? page.locator('.vacancy-push') : target;
  await detailScope.getByRole('button', { name: /Полное описание/u }).click();
  const description = page.locator('.career-modal-card.is-detail');
  await expect(description).toBeVisible();
  await capture(page, 'description', width, viewportHeight);
  await page.keyboard.press('Escape');
  await expect(description).toBeHidden();
  if (mobile) await page.locator('.vacancy-push').getByRole('button', { name: 'Назад' }).click();

  await page.getByRole('tab', { name: /Сохранённые/u }).click();
  await expect(page.locator('.vacancies-saved-panel')).toBeVisible();
  await capture(page, 'saved', width, viewportHeight);

  await page.getByRole('tab', { name: /Подборка/u }).click();
  if (mobile) {
    const map = page.getByRole('button', { name: 'Карта', exact: true });
    await map.click();
  } else {
    await page.getByRole('tab', { name: 'Карта', exact: true }).click();
  }
  await expect(page.locator('.vacancy-map-view')).toBeVisible();
  await capture(page, 'map', width, viewportHeight);

  if (mobile) {
    await page.getByRole('button', { name: 'Список', exact: true }).click();
  } else {
    await page.getByRole('tab', { name: 'Список', exact: true }).click();
  }
  const companyRow = page
    .locator('.vac-list-item')
    .filter({ hasText: 'Product Lead, Merchant Onboarding' })
    .filter({ hasText: 'Revolut' })
    .first();
  const companyPathTrigger = companyRow.locator('.vacancies-screen-row-trigger');
  if ((await companyPathTrigger.getAttribute('aria-expanded')) !== 'true')
    await companyPathTrigger.click();
  if (mobile) {
    // B549: «Вакансия» push → «Путь к компании» → the first circle without contacts.
    const push = page.locator('.vacancy-push');
    await push.getByRole('button', { name: /Путь к компании/u }).click();
    await push.locator('.vacancy-push-circle').first().click();
  } else {
    await companyRow
      .locator('.vacancies-screen-detail-actions')
      .getByRole('button', { name: /Путь к компании/u })
      .click();
    // B549: the path opens inside the row; the people screen is one step further.
    await companyRow
      .locator('.vacancy-path-panel')
      .getByRole('button', { name: 'Добавить контакты' })
      .first()
      .click();
  }
  await expect(page.getByRole('heading', { name: 'Revolut' })).toBeVisible();
  await capture(page, 'company-path', width, viewportHeight);
});
