import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { mockPrep, PREP_NOW, type PrepMockOptions } from './interviewFixture';

async function open(page: Page, path: string, node: string, options: PrepMockOptions = {}) {
  await page.clock.setFixedTime(new Date(PREP_NOW));
  const mock = await mockPrep(page, options);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`[data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return mock;
}

const headline = (page: Page) => page.getByRole('heading', { level: 2 }).first();

test.describe('B659: «Подготовка к интервью» (I1)', () => {
  test('вкладка «Подготовка» находит ближайшее интервью: вопросы, готовность, «Спросите сами»', async ({
    page,
  }) => {
    await open(page, '/app/responses/next/interview', 'i01');
    await expect(headline(page)).toHaveText(/^Готов ответ на 1 вопрос из \d+$/u);
    const rows = page.locator('ul.exp-rows > li.row');
    await expect(rows.filter({ hasText: 'Ожидания по зарплате' })).toContainText(
      'Ответ готов · от 500 000 ₽',
    );
    await expect(rows.locator('.tag.part').first()).toHaveText('нужен ответ');
    await expect(page.getByRole('link', { name: 'Пробное интервью' })).toHaveAttribute(
      'href',
      '/app/responses/r-arka/interview/mock',
    );
    await expect(page.getByRole('heading', { name: 'Спросите сами' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Шаги' }).getByRole('link', { name: 'Подготовка' }),
    ).toHaveAttribute('aria-current', 'page');
    await expectGates(page);
  });

  test('«Подготовить ответ»: пример из истории становится ответом, сбой не закрывает окно', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses/r-arka/interview', 'i01', { failPrep: 1 });
    const first = page.locator('ul.exp-rows > li.row').first();
    const question = (await first.locator('.row-title').textContent()) ?? '';
    await page.getByRole('button', { name: 'Подготовить ответ' }).click();
    const dialog = page.getByRole('dialog', { name: question });
    await expect(dialog.getByRole('radio', { name: 'переход на Kubernetes, 2024' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Взять пример' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Ответ не сохранился. Попробуйте ещё раз.');
    await dialog.getByRole('button', { name: 'Взять пример' }).click();
    await expect(dialog).toBeHidden();
    await expect(first).toContainText('Ответ готов · пример: переход на Kubernetes, 2024');
    await expect(first.locator('.tag')).toHaveText('готово');
    await expect(headline(page)).toHaveText(/^Готовы ответы на 2 вопроса из \d+$/u);
    expect(mock.calls).toEqual([
      'PUT star-prep star-q1-tech:situation,star-q1-tech:task,star-q1-tech:action,star-q1-tech:result',
    ]);
  });

  test('интервью не записано (I1d): прошедшая дата — ошибка поля, будущая открывает подготовку', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses/r-arka/interview', 'i01d', { noInterview: true });
    await expect(page.getByRole('heading', { name: 'Когда интервью?' })).toBeVisible();
    await expectGates(page);
    await page.getByLabel('Дата и время').fill('2026-11-09T15:00');
    await page.getByRole('button', { name: 'Готовиться' }).click();
    await expect(page.getByText('Эта дата уже прошла')).toBeVisible();
    expect(mock.calls).toEqual([]);
    await page.getByLabel('Дата и время').fill('2026-11-12T15:00');
    await page.getByRole('button', { name: 'Готовиться' }).click();
    await expect(page.locator('[data-b640-node="i01"]')).toBeVisible();
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatch(/^POST interview 2026-11-12T/u);
  });

  test('откликов с интервью нет: одна строка и путь к откликам', async ({ page }) => {
    await page.clock.setFixedTime(new Date(PREP_NOW));
    await mockPrep(page, { noResponses: true });
    await page.goto('/app/responses/next/interview', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Интервью пока не назначено ни по одному отклику.')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: 'К откликам' })).toHaveAttribute(
      'href',
      '/app/responses',
    );
  });
});
