import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import { mockOffers, type OffersMockOptions } from './offersFixture';

async function open(page: Page, path: string, node: string, options: OffersMockOptions = {}) {
  const mock = await mockOffers(page, options);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`[data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return mock;
}

const LETTER =
  'Здравствуйте, Марина! Рады предложить вам должность руководителя разработки. Оклад 520 000 ₽ в месяц на руки. Первые 3 месяца — испытательный срок, оклад на нём 500 000 ₽. Годовая премия до 2 окладов. Формат: гибрид, 2 дня в офисе. ДМС со стоматологией и оплата спорта. Выход 1 декабря. Просим ответить до 14 ноября.';

const cell = (page: Page, row: string, company: string) =>
  page
    .locator('table.cmp tr', { has: page.locator('th', { hasText: row }) })
    .locator(`td[data-col="${company}"]`);

test.describe('B658: «Офферы» нового кабинета', () => {
  test('сравнение: планка в заголовке, шесть условий, пересчёт валюты', async ({
    page,
  }, testInfo) => {
    await open(page, '/app/responses/offers', 'o06');
    await expect(page.getByRole('heading', { name: 'Оба выше вашей планки' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Подготовить встречное' })).toHaveAttribute(
      'href',
      '/app/consultant',
    );
    if (testInfo.project.name === 'mobile-390') {
      await expect(page.locator('.cmp-line')).toHaveText(
        'Вектор Банк 520 тыс. ₽ · Гринкод ≈ 590 тыс. ₽',
      );
      await page.getByText('Все 6 условий рядом').click();
    }
    await expect(cell(page, 'Оклад на руки', 'Вектор Банк')).toHaveText('520 тыс. ₽');
    await expect(cell(page, 'Оклад на руки', 'Гринкод')).toContainText(
      '6,5 тыс. $ ≈ 590 тыс. ₽ до налога',
    );
    await expect(cell(page, 'Оклад на руки', 'Гринкод').getByRole('link')).toHaveAttribute(
      'href',
      '/app/responses/offers/o-green',
    );
    await expect(cell(page, 'Бонус', 'Вектор Банк')).toHaveText('2 оклада в год');
    await expect(cell(page, 'Риски', 'Вектор Банк')).toHaveText(
      'Испытательный срок 3 месяца; Премия не гарантирована',
    );
    await expect(cell(page, 'Ответить до', 'Гринкод')).toHaveText('18 ноября');
    await page.locator('.ccy-seg label', { hasText: '$' }).click();
    await expect(cell(page, 'Оклад на руки', 'Вектор Банк')).toHaveText('520 тыс. ₽ ≈ 5,7 тыс. $');
    await expectGates(page);
  });

  test('решение записывается сразу, «Принимаю» ведёт в «Работаю», «Думаю» снимает', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses/offers', 'o06');
    const decide = page.getByRole('group', { name: 'Решение по офферу: Вектор Банк' });
    await expect(decide.getByRole('radio', { name: 'Думаю' })).toBeChecked();
    await decide.getByRole('radio', { name: 'Принимаю' }).check();
    await expect(page.getByRole('status').filter({ hasText: 'Решение записано' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Перейти в «Работаю»' })).toHaveAttribute(
      'href',
      '/app/profile/status?status=working',
    );
    await decide.getByRole('radio', { name: 'Думаю' }).check();
    await expect(page.getByText('Решение записано')).toHaveCount(0);
    expect(mock.calls).toEqual([
      'PUT decision o-vector {"decision":"accepted"}',
      'PUT decision o-vector {"decision":null}',
    ]);
  });

  test('ошибка решения показана на месте, «Повторить» записывает', async ({ page }) => {
    await open(page, '/app/responses/offers', 'o06', { failDecision: 1 });
    const decide = page.getByRole('group', { name: 'Решение по офферу: Вектор Банк' });
    await decide.getByRole('radio', { name: 'Отказываюсь' }).click();
    await expect(page.getByRole('alert')).toContainText('Решение не записалось');
    await expect(decide.getByRole('radio', { name: 'Думаю' })).toBeChecked();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Решение записано')).toBeVisible();
    await expect(decide.getByRole('radio', { name: 'Отказываюсь' })).toBeChecked();
  });

  test('условия оффера: поля из оффера, доход по формуле, налог сохраняется', async ({ page }) => {
    const mock = await open(page, '/app/responses/offers/o-vector', 'o06a');
    await expect(page.getByLabel('Оклад', { exact: true })).toHaveValue('520 000');
    await expect(page.getByLabel('Срок ответа')).toHaveValue('14.11.2026');
    await expect(page.locator('.of-total b')).toHaveText('7 220 000 ₽');
    await expect(page.locator('.of-sum small')).toHaveText(
      '3 мес. по 500 000 ₽ и 9 мес. по 520 000 ₽',
    );
    await page.getByLabel('Годовой бонус / премия').fill('520 000');
    await expect(page.locator('.of-total b')).toHaveText('6 700 000 ₽');
    await page.getByLabel('Налог, %').fill('13');
    await expectGates(page);
    await page.getByRole('button', { name: 'Сохранить условия' }).click();
    await expect(page.locator('[data-b640-node="o06"]')).toBeVisible();
    await expect(page.getByText('Условия сохранены')).toBeVisible();
    expect(
      mock.calls.some(
        (call) =>
          call.startsWith('PUT offer o-vector') && call.includes('"startDate":"2026-12-01"'),
      ),
    ).toBe(true);
    expect(mock.calls).toContain('PUT tax o-vector {"taxPercent":13}');
  });

  test('неверное поле: ошибка под полем, ничего не отправлено; сбой сохранения не теряет ввод', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses/offers/o-green', 'o06a', { failSave: 1 });
    await page.getByLabel('Срок ответа').fill('31.02.2026');
    await page.getByRole('button', { name: 'Сохранить условия' }).click();
    await expect(page.getByText('Дата в виде дд.мм.гггг')).toBeVisible();
    expect(mock.calls).toEqual([]);
    await page.getByLabel('Срок ответа').fill('20.11.2026');
    await page.getByRole('button', { name: 'Сохранить условия' }).click();
    await expect(page.getByRole('alert')).toContainText('Условия не сохранились');
    await expect(page.getByLabel('Срок ответа')).toHaveValue('20.11.2026');
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Условия сохранены')).toBeVisible();
  });

  test('письмо с оффером: разбор подставляет поля в рамке, правка снимает рамку, дата выхода сохраняется (B646)', async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    const mock = await open(page, '/app/responses/offers/o-green', 'o06a');
    await page.getByRole('button', { name: 'Разобрать текст' }).click();
    await expect(page.getByRole('alert')).toHaveText('Вставьте текст письма с оффером.');
    await page.getByLabel('Вставить текст письма с оффером').fill(LETTER);
    await page.getByRole('button', { name: 'Разобрать текст' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Подставили из письма' }),
    ).toBeVisible();
    await expect(page.getByLabel('Оклад', { exact: true })).toHaveValue('520 000');
    await expect(page.getByLabel('Валюта')).toHaveValue('RUB');
    await expect(page.getByLabel('Налог, %')).toHaveValue('0');
    // «до 2 окладов» — потолок, а не бонус (B645, o06a): поле остаётся прежним и «с ваших слов».
    await expect(page.getByLabel('Годовой бонус / премия')).toHaveValue('0');
    await expect(page.getByLabel('Формат работы')).toHaveValue('hybrid');
    await expect(page.getByLabel('Срок ответа')).toHaveValue('14.11.2026');
    await expect(page.getByLabel('Бенефиты (через запятую)')).toHaveValue(
      'ДМС со стоматологией, оплата спорта',
    );
    await expect(page.locator('.of-f.is-letter')).toHaveCount(9);
    await expectGates(page);
    await page.getByLabel('Оклад', { exact: true }).fill('530 000');
    await expect(page.locator('.of-f.is-letter')).toHaveCount(8);
    await expect(
      page.locator('.of-f', { has: page.getByLabel('Оклад', { exact: true }) }).locator('.of-src'),
    ).toHaveText('с ваших слов');
    await page.getByRole('button', { name: 'Сохранить условия' }).click();
    await expect(page.getByText('Условия сохранены')).toBeVisible();
    const put = mock.calls.find((call) => call.startsWith('PUT offer o-green')) ?? '';
    expect(put).toContain('"baseSalary":530000');
    expect(put).toContain('"startDate":"2026-12-01"');
    expect(mock.calls).toContain('PUT tax o-green {"taxPercent":0}');
  });

  test('офферов нет: одна строка, «Добавить оффер» заводит оффер вне откликов', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses/offers', 'o06', { empty: true });
    await expect(page.getByRole('heading', { name: 'Офферов пока нет' })).toBeVisible();
    await expectGates(page);
    await page.getByRole('link', { name: 'Добавить оффер' }).click();
    await expect(page.locator('[data-b640-node="o06a"]')).toBeVisible();
    await page.getByLabel('Компания').fill('Гринкод');
    await page.getByLabel('Должность').fill('Head of Engineering');
    await page.getByLabel('Оклад', { exact: true }).fill('300000');
    await page.getByRole('button', { name: 'Сохранить условия' }).click();
    await expect(page.getByText('Условия сохранены')).toBeVisible();
    expect(mock.calls[0]).toBe('POST applications Гринкод');
    expect(mock.calls[1]).toContain('"baseSalary":300000');
  });
});
