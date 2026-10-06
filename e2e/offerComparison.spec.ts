import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockSignedInCabinet } from './fixtures/mockSignedInCabinet';
import { candidate } from './fixtures/readabilityWorkspace';

/**
 * B394 — Сравнение офферов: матрица условий и итоговая компенсация.
 * Критерии приёмки:
 * - До 4 офферов в одной матрице;
 * - Итог считается формулой, а не моделью;
 * - Числа без источника помечены «со слов кандидата»;
 * - Адаптив: на 390 px — стопка строк;
 * - e2e (два оффера → матрица) на 1440 и 390.
 */

function makeApplication(overrides: Record<string, unknown>) {
  return {
    id: overrides.id,
    candidateId: candidate.candidateId,
    clusterId: null,
    stage: 'offer',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: null,
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-20T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    archiveStaleDays: 30,
    offer: null,
    ...overrides,
  };
}

const APPLICATIONS_WITH_OFFERS = [
  makeApplication({
    id: 'app-offer-1',
    stage: 'offer',
    vacancy: {
      title: 'Senior Solution Architect',
      company: 'Альфа-Банк',
      url: 'https://hh.ru/vacancy/101',
      source: 'hh',
    },
    offer: {
      applicationId: 'app-offer-1',
      respondBy: '2026-10-15T00:00:00.000Z',
      terms: {
        baseSalary: 350_000,
        salaryPeriod: 'month',
        bonus: 700_000,
        currency: 'RUB',
        format: 'remote',
        probationPeriodMonths: 3,
        probationSalary: 300_000,
        benefits: ['ДМС со стоматологией', 'Оплата спорта'],
        risks: ['Возможны ночные дежурства'],
        sourceNote: 'со слов кандидата',
      },
    },
  }),
  makeApplication({
    id: 'app-offer-2',
    stage: 'offer',
    vacancy: {
      title: 'Principal Architect',
      company: 'Т-Банк',
      url: 'https://hh.ru/vacancy/102',
      source: 'hh',
    },
    offer: {
      applicationId: 'app-offer-2',
      respondBy: '2026-10-20T00:00:00.000Z',
      terms: {
        baseSalary: 420_000,
        salaryPeriod: 'month',
        bonus: 1_000_000,
        currency: 'RUB',
        format: 'hybrid',
        probationPeriodMonths: 0,
        benefits: ['ДМС бизнес-класс', 'Бюджет на обучение'],
        risks: ['Офис 2 дня в неделю'],
        sourceNote: 'со слов кандидата',
      },
    },
  }),
];

test.describe('B394 offer comparison matrix', () => {
  test.beforeEach(async () => {
    await mkdir('output/playwright/B394', { recursive: true });
  });

  test('opens matrix, compares 2 offers by formula, marks source and highlights leader', async ({
    page,
  }, testInfo) => {
    await mockSignedInCabinet(page);
    await page.route('**/api/v1/candidate/applications*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/v1/candidate/applications') {
        return route.fulfill({ json: { data: APPLICATIONS_WITH_OFFERS } });
      }
      return route.fallback();
    });

    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toHaveAttribute('aria-busy', /.*/);

    // Открываем экран «Отклики»
    const rail = page.locator('aside#career-rail nav');
    const mobile = page.locator('nav.career-mobile-nav');
    const nav = (await rail.isVisible()) ? rail : mobile;
    await nav.getByRole('button', { name: 'Отклики', exact: true }).click();

    // Доска должна открыться
    await expect(page.locator('.career-responses-board-wrap')).toBeVisible();

    // Колонка «Оффер» должна содержать 2 карточки и кнопку сравнения
    const compareBtn = page.getByTestId('compare-offers-btn');
    await expect(compareBtn).toBeVisible();
    await expect(compareBtn).toContainText('Сравнить офферы (2)');

    // Кликаем кнопку открытия матрицы
    await compareBtn.click();

    // Проверяем диалог матрицы
    const dialog = page.locator('div[aria-label="Сравнение офферов"]');
    await expect(dialog).toBeVisible();

    if (testInfo.project.name === 'desktop-1440') {
      // На десктопе отображается таблица матрицы
      const table = page.locator('.career-offer-matrix-table');
      await expect(table).toBeVisible();

      // Проверяем наличие обеих компаний в шапке
      await expect(table).toContainText('Альфа-Банк');
      await expect(table).toContainText('Т-Банк');

      // Проверяем бейдж лидера по компенсации (у Т-Банка 6 040 000 руб. > Альфа-Банк 4 750 000 руб.)
      const leaderBadge = table.locator('.career-offer-matrix-badge-leader');
      await expect(leaderBadge).toBeVisible();
      await expect(leaderBadge).toHaveText('Лидер по доходу');

      // Проверяем метку источника
      await expect(table.locator('.career-offer-source-badge').first()).toHaveText(
        'со слов кандидата',
      );

      // Проверяем строки параметров
      await expect(table).toContainText('Совокупный доход в год');
      await expect(table).toContainText('Базовый оклад');
      await expect(table).toContainText('Годовой бонус / премия');
      await expect(table).toContainText('Формат работы');
      await expect(table).toContainText('Испытательный срок');
      await expect(table).toContainText('Бенефиты и льготы');
      await expect(table).toContainText('Риски и нюансы');

      // Скриншот на 1440
      await page.screenshot({
        path: 'output/playwright/B394/offer-matrix-1440.png',
        fullPage: false,
      });
    }

    if (testInfo.project.name === 'mobile-390') {
      // На мобильном отображается стопка строк (карточек)
      const stack = page.locator('.career-offer-matrix-mobile-stack');
      await expect(stack).toBeVisible();

      const cards = page.locator('.career-offer-mobile-card');
      await expect(cards).toHaveCount(2);

      // Проверяем карточку лидера
      await expect(cards.filter({ hasText: 'Т-Банк' })).toHaveClass(/is-leader/);
      await expect(cards.filter({ hasText: 'Т-Банк' })).toContainText('Лидер по доходу');

      // Проверяем метку источника
      await expect(cards.first().locator('.career-offer-source-badge')).toHaveText(
        'со слов кандидата',
      );

      // Проверяем отсутствие горизонтального скролла на 390
      const isOverflowing = await page.evaluate(() => {
        const docEl = document.documentElement;
        return docEl.scrollWidth > docEl.clientWidth;
      });
      expect(isOverflowing).toBe(false);

      // Скриншот на 390
      await page.screenshot({
        path: 'output/playwright/B394/offer-matrix-390.png',
        fullPage: false,
      });
    }

    // Закрываем матрицу крестиком
    await page.getByTestId('close-matrix-btn').click();
    await expect(dialog).not.toBeVisible();
  });
});
