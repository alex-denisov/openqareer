import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { PREP_NOW } from './interviewFixture';
import { mockInterview, type MockInterviewOptions } from './mockInterviewFixture';

async function open(page: Page, options: MockInterviewOptions = {}) {
  await page.clock.setFixedTime(new Date(PREP_NOW));
  const mock = await mockInterview(page, options);
  await page.goto('/app/responses/r-arka/interview/mock', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="i02"]')).toBeVisible({ timeout: 15_000 });
  return mock;
}

test.describe('B659: «Пробное интервью» (I2)', () => {
  test('вопрос, ответ, разбор по критериям, «Ответить ещё раз», следующий вопрос и «Закончить»', async ({
    page,
  }) => {
    const mock = await open(page);
    await expect(page.getByText('Пробное интервью · Арка Холдинг · вопрос 1 из 2')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: '«Расскажите о самом тяжёлом релизе»' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(page.getByText('Напишите ответ', { exact: true })).toBeVisible();
    await page.getByLabel('Ваш ответ').fill('В 2024 году мы переводили платформу на Kubernetes.');
    await page.getByRole('button', { name: 'Ответить', exact: true }).click();
    const rows = page.locator('ul.mi-crit > li.row');
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText('Ситуация и ваша роль');
    await expect(rows.first().locator('.tag')).toHaveText('есть');
    await expect(rows.last().locator('.tag')).toHaveText('добавить');
    await expectGates(page);
    await page.getByRole('button', { name: 'Ответить ещё раз' }).click();
    await page.getByLabel('Ваш ответ').fill('Сократили релиз с 4 часов до 20 минут.');
    await page.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(rows).toHaveCount(4);
    await page.getByRole('button', { name: 'Следующий вопрос' }).click();
    await expect(page.getByText('вопрос 2 из 2')).toBeVisible();
    await expect(page.getByLabel('Ваш ответ')).toHaveValue('');
    await page.getByRole('button', { name: 'Закончить' }).click();
    await expect(page.locator('[data-b640-node="i01"]')).toBeVisible();
    expect(mock.calls).toEqual([
      'start',
      'answer q-release replace=false',
      'answer q-release replace=true',
      'next s-1',
      'finish s-1',
    ]);
  });

  test('тариф без пробных интервью: одна строка и путь к тарифам', async ({ page }) => {
    await open(page, { paywall: true });
    await expect(page.getByText('Пробное интервью — на платном тарифе.')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Тарифы' })).toHaveAttribute(
      'href',
      '/app/tariffs',
    );
  });

  test('не закончено интервью по другому отклику: закончить его и начать это', async ({ page }) => {
    const mock = await open(page, { otherSession: true });
    await expect(page.getByText('Не закончено пробное интервью «Head of Platform».')).toBeVisible();
    await page.getByRole('button', { name: 'Закончить его и начать это' }).click();
    await expect(page.getByText('Пробное интервью · Арка Холдинг · вопрос 1 из 2')).toBeVisible();
    expect(mock.calls).toEqual(['finish s-old', 'start']);
  });
});
