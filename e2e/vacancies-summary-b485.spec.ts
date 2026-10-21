import { expect, test, type Page } from '@playwright/test';
import type { MatchedVacancyFacets } from '../shared/matchedVacancyFacets';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { mockCandidateCompanies } from './fixtures/mockCandidateCompanies';

const EVIDENCE = process.env.B485_EVIDENCE_DIR;

const vacancyFacets: MatchedVacancyFacets = {
  total: 148,
  catalogSummary: {
    roleLevelMatches: 214,
    catalogTotal: 1620,
    observedAt: '2026-10-07T06:12:00.000Z',
  },
  regions: [],
  remote: 0,
  levels: [],
  roles: [],
  sources: [],
};

async function openVacancies(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { vacancyTotal: 148, vacancyFacets });
  await mockCandidateCompanies(page, { companyCount: 61 });
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Вакансии', exact: true }).click();
  await expect(page.locator('.vac-list-item').first()).toBeVisible();
}

async function evidence(page: Page, name: string): Promise<void> {
  if (!EVIDENCE) return;
  const width = page.viewportSize()?.width ?? 0;
  await page.screenshot({
    path: `${EVIDENCE}/app-${width}-${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

test.describe('B485 — сводка каталога, подвал и счётчики', () => {
  test('сводка, подвал, вкладки и число выдачи', async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-390';
    await openVacancies(page);
    const tabs = page.getByRole('tablist', { name: 'Разделы вакансий' });
    await expect(tabs.getByRole('tab', { name: 'Подборка 148' })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: 'Компании и люди 61' })).toBeAttached();
    const footer = page.locator('.vacancies-screen-footer');
    if (mobile) {
      await expect(page.locator('.vacancies-mobile-results-summary')).toContainText(
        '148 вакансий по вашим условиям',
      );
      await expect(footer).toContainText(/Показано 20 из 148\. Каталог на 07\.10 09:12\./u);
    } else {
      const summary = page.getByRole('region', { name: 'Сводка подбора' });
      await expect(summary).toContainText(
        '214 из 1 620 вакансий каталога подходят по роли и уровню.',
      );
      await expect(summary).toContainText('Каталог на 07.10 09:12');
      await expect(footer).toContainText('Показано 20 из 148');
      await expect(
        footer.getByRole('button', { name: 'Все компании подборки в «Хочу» (61)' }),
      ).toBeVisible();
    }
    await expect(footer.getByRole('button', { name: 'Показать ещё 20' })).toBeVisible();
    await evidence(page, 'base');
  });

  test('карта: заметка с числами выдачи, видна только вкладка «Подборка»', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-390';
    await openVacancies(page);
    if (mobile) await page.locator('.vacancies-mobile-map-action').click();
    else
      await page
        .getByRole('tablist', { name: 'Режим просмотра' })
        .getByRole('tab', { name: 'Карта' })
        .click();
    const note = page.locator('.vacancy-map-note');
    await expect(note).toContainText(/На карте \d+ из 148/u);
    const tabs = page.getByRole('tablist', { name: 'Разделы вакансий' });
    await expect(tabs.getByRole('tab')).toHaveCount(1);
    await expect(tabs.getByRole('tab', { name: 'Подборка 148' })).toBeAttached();
    await evidence(page, 'map');
  });
});
