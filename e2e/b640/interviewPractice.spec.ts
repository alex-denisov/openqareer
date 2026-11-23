import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { PREP_NOW } from './interviewFixture';
import {
  mockPractice,
  PRACTICE_ANSWER,
  PRACTICE_TASK,
  type PracticeOptions,
} from './practiceFixture';

const PATH = '/app/responses/r-arka/interview/practice';

async function speechStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      static available = async () => 'available';
      processLocally = false;
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((event: never) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        this.onstart?.();
      }
      stop() {
        this.onend?.();
      }
      abort() {
        this.onend?.();
      }
    }
    Object.assign(window, { SpeechRecognition: FakeSpeechRecognition });
  });
}

/** Браузер без заглушки запускает настоящую диктовку: в безоконном Chromium она подвешивает страницу. */
async function open(page: Page, options: PracticeOptions = {}, query = '') {
  await speechStub(page);
  await page.clock.setFixedTime(new Date(PREP_NOW));
  const state = await mockPractice(page, options);
  await page.goto(`${PATH}${query}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node="i03"]')).toBeVisible({ timeout: 15_000 });
  return state;
}

const steps = (page: Page) => page.getByRole('list', { name: 'Шаги тренировки' });

test.describe('B750: «Тренировка System Design» (I3)', () => {
  test('задача → ответ со схемой и критериями → разбор, схема в подготовку, «Разбор помог?»', async ({
    page,
  }) => {
    const state = await open(page);
    await expect(steps(page).getByRole('link', { name: '1 Задача' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.getByRole('heading', { name: 'Что важно в задаче' })).toBeVisible();
    // B750: пункты — те, что сервер написал по вакансии, ровно четыре.
    await expect(page.locator('.sd-reqs li')).toHaveText(PRACTICE_TASK.points);
    await expect(page.getByRole('heading', { name: PRACTICE_TASK.title })).toBeVisible();
    await expect(page.locator('.sd-time')).toHaveText('45 минут на ответ');
    await expect(page.getByText('Пробные интервью: осталось 27 из 30')).toBeVisible();
    await expectGates(page);

    await page.getByRole('radiogroup', { name: 'Как отвечать' }).getByLabel('Текстом').check();
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(steps(page).getByRole('link', { name: '2 Ответ' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(page.locator('.lead-sub')).toHaveText('Арка Холдинг · 45 минут');
    await page.getByRole('button', { name: 'Закончить и разобрать' }).click();
    await expect(page.getByText('Напишите ответ', { exact: true })).toBeVisible();
    await page.getByLabel('Ваш ответ').fill(PRACTICE_ANSWER);
    const criteria = page.locator('ul.exp-rows > li.row');
    await expect(criteria.first().locator('.tag')).toHaveText('прозвучало');
    await expect(criteria.nth(2)).toContainText('Пока не звучало');
    const map = page.getByRole('list', { name: 'Схема по вашему ответу, блоки по порядку' });
    const nodes = map.locator('li.sd-node');
    const count = await nodes.count();
    expect(count).toBeGreaterThanOrEqual(3);
    await expect(nodes.first().getByRole('button', { name: 'Выше' })).toBeDisabled();
    await expect(nodes.last().getByRole('button', { name: 'Ниже' })).toBeDisabled();
    await page.getByRole('button', { name: 'Подсказка' }).click();
    await expect(page.getByRole('button', { name: 'Подсказка' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await page.getByRole('button', { name: 'Добавить блок' }).click();
    await page.getByLabel('Название блока').fill('Кэш ключей повтора');
    await page.getByLabel('Название блока').press('Enter');
    await expect(nodes.last()).toContainText('Кэш ключей повтора');
    await nodes.first().getByRole('button', { name: 'Убрать' }).click();
    await expect(nodes).toHaveCount(count);
    // Курсор остался над «Убрать» следующего блока: подсветка наведения — не рамка строки.
    await page.mouse.move(0, 0);
    await expectGates(page);

    await page.getByRole('button', { name: 'Закончить и разобрать' }).click();
    await expect(
      page.getByRole('heading', { name: 'Четыре критерия: два закрыты, два — не полностью' }),
    ).toBeVisible();
    await expect(steps(page).getByRole('link', { name: '3 Разбор' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    const rows = page.locator('ul.exp-rows > li.row');
    await expect(rows.first()).toContainText('Из ответа: «2 000 платежей в секунду»');
    await expect(rows.nth(2).locator('.tag')).toHaveText('не хватило');
    await expect(rows.nth(3).locator('.tag')).toHaveText('частично');
    await expect(page.locator('.sd-map:not(.is-edit) .sd-node').last()).toHaveText(
      'Кэш ключей повтора',
    );
    await page.getByText('Пример сильного ответа').click();
    await expect(page.getByText('Приложение шлёт ключ повтора.')).toBeVisible();
    await page.getByRole('button', { name: 'Сохранить схему в подготовку' }).click();
    await expect(page.getByText('Схема сохранена в подготовку.')).toBeVisible();
    await page.getByRole('button', { name: 'Да', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Да', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('link', { name: 'Открыть памятку' })).toHaveAttribute(
      'href',
      '/app/responses/r-arka/interview',
    );
    await expectGates(page);
    expect(state.calls).toEqual([
      'start text system_design',
      'answer q-sd-1',
      'schema PUT',
      'finish',
      'review POST',
      'schema PUT',
      'helpful PUT',
    ]);
    expect(state.schemas[0]).toMatchObject({ nodes: expect.any(Array), links: expect.any(Array) });
  });

  test('возврат к отвеченной тренировке открывает разбор; «Задача» — снова условие', async ({
    page,
  }) => {
    await open(page, { answered: PRACTICE_ANSWER });
    await expect(
      page.getByRole('heading', { name: 'Четыре критерия: два закрыты, два — не полностью' }),
    ).toBeVisible();
    await expect(page.locator('.sd-map:not(.is-edit) .sd-node').first()).toBeVisible();
    await steps(page).getByRole('link', { name: 'Задача' }).click();
    await expect(page.getByRole('heading', { name: 'Что важно в задаче' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible();
  });

  test('с микрофоном можно выбрать «Голосом» или «Текстом»', async ({ page }) => {
    const state = await open(page);
    const how = page.getByRole('radiogroup', { name: 'Как отвечать' });
    await expect(how.getByLabel('Голосом')).toBeChecked();
    await how.getByLabel('Текстом').check();
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.getByLabel('Ваш ответ')).toBeVisible();
    expect(state.calls[0]).toBe('start text system_design');
  });

  test('пробные интервью закончились: строка и путь к тарифам', async ({ page }) => {
    await open(page, { paywall: true });
    await page.getByRole('button', { name: 'Начать' }).click();
    await expect(page.getByText('Пробные интервью на этом тарифе закончились.')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Тарифы' })).toHaveAttribute(
      'href',
      '/app/tariffs',
    );
  });

  test('снимки I3a, I3b, I3c на 1440 и 390', async ({ page }) => {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await open(page);
      await page.screenshot({ path: `.s13-shots/i03a-${width}.png`, fullPage: true });
      await page.getByRole('radiogroup', { name: 'Как отвечать' }).getByLabel('Текстом').check();
      await page.getByRole('button', { name: 'Начать' }).click();
      await page.getByLabel('Ваш ответ').fill(PRACTICE_ANSWER);
      await page.screenshot({ path: `.s13-shots/i03b-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Закончить и разобрать' }).click();
      await expect(page.getByRole('heading', { name: /^Четыре критерия/u })).toBeVisible();
      await page.screenshot({ path: `.s13-shots/i03c-${width}.png`, fullPage: true });
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    }
  });
});
