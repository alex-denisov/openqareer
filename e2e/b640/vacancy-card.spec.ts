import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const CARD_PATH = '/app/vacancies/cluster-0';

const requirement = (id: string, text: string) => ({
  id,
  text,
  sourceQuote: text,
  origin: 'explicit',
  importance: 'high',
  kind: 'experience',
  hard: false,
  stopFactor: false,
  skill: true,
});

const FIT_VIEW = {
  state: 'ready',
  requirements: [
    requirement('a', 'Kubernetes'),
    requirement('b', 'Найм руководителей'),
    requirement('c', 'English C1'),
    requirement('d', 'Go и PostgreSQL'),
  ],
  result: {
    candidateId: 'c',
    vacancyId: 'cluster-0',
    algorithmVersion: 'evidence-coverage-9',
    status: 'assessed',
    calculatedAt: '2026-11-11T09:00:00Z',
    dataState: 'confirmed',
    coveragePercent: 75,
    requiredCoverage: { matched: 2, total: 4, percent: 50 },
    coverage: { matched: 2, total: 4, unknown: 1, partial: 1 },
    reason: 'assessed',
    gates: {},
    assessments: [
      {
        requirementId: 'a',
        status: 'matched',
        evidence: [{ factId: 'f1', quote: 'Финтех Лаб · переход на Kubernetes, 2024' }],
      },
      {
        requirementId: 'b',
        status: 'partial',
        evidence: [{ factId: 'f2', quote: 'Финтех Лаб · нанимали разработчиков' }],
      },
      { requirementId: 'c', status: 'unknown', evidence: [] },
      {
        requirementId: 'd',
        status: 'matched',
        evidence: [{ factId: 'f3', quote: 'Финтех Лаб · Go, PostgreSQL' }],
      },
    ],
  },
} as unknown as VacancyFitView;

const DETAIL = {
  id: 'cluster-0',
  description:
    'О вакансии:\nКоманда платежей, 40 человек.\n\nЗадачи:\nРуководить развитием платёжной платформы.',
  truncated: false,
  skills: [],
  responsibilities: [],
};

async function openCard(page: Page): Promise<void> {
  await mockSignedInCabinet(page, { cabinetB640: true, firstVacancyFitView: FIT_VIEW });
  await page.route('**/api/v1/candidate/vacancies/*/detail', (route) =>
    route.fulfill({ json: { data: DETAIL } }),
  );
  await page.route('**/api/v1/vacancies/*/contacts', (route) =>
    route.fulfill({ json: { data: { contacts: [], job: null } } }),
  );
  await page.goto(CARD_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="v04"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.v4-fit-n').first()).toContainText('Совпадение 75 %');
}

test.describe('B654: карточка вакансии нового кабинета', () => {
  test('открывается по адресу: шапка, совпадение, шаги', async ({ page }) => {
    await openCard(page);
    await expect(page.locator('.r6-steps [aria-current="page"]')).toHaveText('Вакансия');
    await expect(page.locator('.v4-head .lead-title')).toBeVisible();
    await expect(page.locator('.v4-req-row')).toContainText('Требования: 2 из 4 есть в профиле');
    await expect(page.getByRole('link', { name: 'Откликнуться' }).first()).toBeVisible();
  });

  test('«Почему 75 %» открывается и закрывается по Esc', async ({ page }) => {
    await openCard(page);
    const dialog = page.locator('.v4-fd');
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Почему 75 %' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.v4-fd-l li')).toHaveCount(4);
    await expect(dialog.locator('.is-part')).toContainText('частично');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('«Текст вакансии» показывает текст и закрывается', async ({ page }) => {
    await openCard(page);
    await page.getByRole('button', { name: 'Текст вакансии' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.v4-tx-h').first()).toHaveText('О вакансии');
    await expect(dialog).toContainText('Команда платежей, 40 человек.');
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    await expect(dialog).toBeHidden();
  });

  test('«Сохранить» отмечает вакансию', async ({ page }) => {
    await openCard(page);
    const save = page.locator('.v4-save:visible');
    await expect(save).toHaveAttribute('aria-pressed', 'false');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
  });

  test('гейты макетов на карточке', async ({ page }) => {
    await openCard(page);
    await expectGates(page);
  });

  test('на 390 «Откликнуться» закреплена внизу', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'телефон');
    await openCard(page);
    const apply = page.locator('.m-commit .is-primary');
    await expect(apply).toBeVisible();
    const box = await apply.boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    expect(box && box.y + box.height).toBeLessThanOrEqual(height);
    const hasScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasScroll).toBe(false);
  });

  test('снимки карточки для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    await openCard(page);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      await page.goto(CARD_PATH, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
      await expect(page.locator('.v4-fit-n').first()).toContainText('Совпадение 75 %');
      for (const width of desktop ? [1440, 1176] : [390]) {
        await page.setViewportSize({ width, height: desktop ? 900 : 844 });
        await page.screenshot({
          path: `.s13-shots/vacancy-card-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  });
});
