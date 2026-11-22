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

// Время интервью в строках — московское; CI работает в UTC.
test.use({ timezoneId: 'Europe/Moscow' });

test.describe('B659: «Подготовка к интервью» (I1)', () => {
  test('вкладка «Подготовка» находит ближайшее интервью: вопросы, готовность, «Спросите сами»', async ({
    page,
  }) => {
    await open(page, '/app/responses/next/interview', 'i01');
    await expect(headline(page)).toHaveText(/^Готов ответ на 1 вопрос из \d+$/u);
    const rows = page.locator('ul.exp-rows > li.row');
    await expect(rows.filter({ hasText: 'Ожидания по зарплате' })).toContainText(
      'Ответ готов · от 500 000 ₽ на руки, вилка вакансии не указана',
    );
    await expect(page.getByText('Пробные интервью: осталось 27 из 30')).toBeVisible();
    await expect(rows.filter({ hasText: 'Запись интервью для разбора' })).toHaveCount(0);
    await expect(rows.locator('.tag.part').first()).toHaveText('нужен ответ');
    await expect(page.getByRole('link', { name: 'Пробное интервью' })).toHaveAttribute(
      'href',
      '/app/responses/r-arka/interview/mock',
    );
    await expect(page.getByRole('link', { name: 'Тренировка' })).toHaveAttribute(
      'href',
      '/app/responses/r-arka/interview/practice',
    );
    await expect(page.getByRole('heading', { name: 'Спросите сами' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Шаги' }).getByRole('link', { name: 'Подготовка' }),
    ).toHaveAttribute('aria-current', 'page');
    await expectGates(page);
  });

  test('при записи разговоров — строка «Запись интервью для разбора» ведёт к загрузке', async ({
    page,
  }) => {
    await open(page, '/app/responses/r-arka/interview', 'i01', { interviewRecording: true });
    const row = page.locator('ul.exp-rows > li.row', { hasText: 'Запись интервью для разбора' });
    await expect(row.getByRole('link', { name: 'Как записать' })).toHaveAttribute(
      'href',
      '/app/responses/r-arka/debrief/upload',
    );
    await expectGates(page);
  });

  test('B749: формат в полосе контекста, «Что известно о компании» из данных платформы, без новостей', async ({
    page,
  }) => {
    await open(page, '/app/responses/r-arka/interview', 'i01');
    await expect(page.locator('.ctx-meta li')).toHaveText([
      '12 ноября, 15:00',
      'видеозвонок с техническим директором',
    ]);
    const about = page.locator('section.mod', { hasText: 'Что известно о компании' });
    await expect(about.locator('dt')).toHaveText(['Чем занята', 'Кто ведёт']);
    await expect(about.locator('dd')).toHaveText([
      'Логистика, Москва',
      'Сергей Минин, технический директор',
    ]);
    await expect(about).not.toContainText('Новости');
    await expect(about.getByRole('button', { name: 'Откуда данные' })).toBeVisible();
    await expectGates(page);
  });

  test('B749: компании нет в данных — одна строка, без выдуманных фактов', async ({ page }) => {
    await open(page, '/app/responses/r-arka/interview', 'i01', { noCompany: true });
    const about = page.locator('section.mod', { hasText: 'Что известно о компании' });
    await expect(about).toContainText('О компании на платформе пока нет данных.');
    await expect(about.locator('dl')).toHaveCount(0);
  });

  test('B749: «Памятка к интервью» собрана из подготовки и копируется текстом', async ({
    page,
  }) => {
    await open(page, '/app/responses/r-arka/interview', 'i01');
    await page.getByRole('button', { name: 'Памятка к интервью' }).click();
    const memo = page.getByRole('dialog', { name: 'Руководитель платформы · Арка Холдинг' });
    await expect(memo).toContainText('12 ноября, 15:00 · видеозвонок с техническим директором');
    await expect(memo.getByRole('heading', { level: 4 })).toHaveText([
      'Ответы',
      'Ожидания по зарплате',
      'Спросите сами',
    ]);
    await expect(memo).toContainText('от 500 000 ₽');
    await expectGates(page);
    await memo.getByRole('button', { name: 'Закрыть' }).click();
    await expect(memo).toBeHidden();
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
    await page.getByLabel('Дата и время').fill('09.11.2026 15:00');
    await page.getByRole('button', { name: 'Готовиться' }).click();
    await expect(page.getByText('Эта дата уже прошла')).toBeVisible();
    expect(mock.calls).toEqual([]);
    await page.getByLabel('Дата и время').fill('12.11.2026 15:00');
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
