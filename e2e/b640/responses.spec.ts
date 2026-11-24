import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectGates } from './gates';
import {
  mockResponses,
  RESUME_BULLET,
  responseFixtures,
  type ResponsesMockOptions,
} from './responsesFixture';

const SHOTS = process.env.B640_SHOTS;

async function open(page: Page, path: string, node: string, options: ResponsesMockOptions = {}) {
  const mock = await mockResponses(page, options);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(`[data-b640-node="${node}"]`)).toBeVisible({ timeout: 15_000 });
  return mock;
}

const row = (page: Page, id: string) => page.locator(`tr[data-response-id="${id}"]`);

test.describe('B656: «Отклики» нового кабинета', () => {
  test('список: строки, чипы стадий, главное действие у черновика', async ({ page }) => {
    await open(page, '/app/responses', 'o01');
    await expect(page.getByRole('heading', { name: '7 откликов' })).toBeAttached();
    await expect(page.locator('tr.ot-row')).toHaveCount(7);
    await expect(row(page, 'a-draft').locator('.tag')).toHaveText('Черновик');
    await expect(row(page, 'a-draft').getByRole('link', { name: 'Проверить письмо' })).toHaveClass(
      /is-primary/u,
    );
    await expect(row(page, 'a-failed').locator('.tag')).toHaveText('не доставлен');
    await expect(row(page, 'a-silent').locator('.tag')).toHaveText('молчат 8 дней');
    await expect(page.locator('tr.ot-row').first()).toHaveAttribute('data-response-id', 'a-draft');

    await page.getByRole('button', { name: 'Архив · 2' }).click();
    await expect(page.locator('tr.ot-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Архив · 2' }).click();
    await expect(page.locator('tr.ot-row')).toHaveCount(7);
    await expectGates(page);
  });

  test('«не отправлен» не рвётся по буквам при окне 1176 (B678)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'ширина окна приложения');
    const applications = responseFixtures().map((item) =>
      item.id === 'a-draft' ? { ...item, materials: { coverLetter: true, resume: true } } : item,
    );
    await open(page, '/app/responses', 'o01', { applications });
    const cell = row(page, 'a-draft').locator('.ot-c-sent');
    await expect(cell).toHaveText('не отправлен');
    for (const width of [1176, 1024, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const fit = await cell.evaluate((node) => {
        const text = node.firstChild!;
        const at = node.textContent!.indexOf('отправлен');
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + 'отправлен'.length);
        return {
          lines: range.getClientRects().length,
          over: node.scrollWidth - node.clientWidth,
          page: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(fit.lines, `${width}`).toBe(1);
      expect(fit.over, `${width}`).toBeLessThanOrEqual(0);
      expect(fit.page, `${width}`).toBeLessThanOrEqual(0);
    }
  });

  test('раскрытый отклик: что дальше, что было, отметка ответа на месте', async ({ page }) => {
    const mock = await open(page, '/app/responses', 'o01');
    await row(page, 'a-interview')
      .getByRole('button', { name: /Руководитель платформы/u })
      .click();
    await expect(page).toHaveURL(/\/app\/responses\/a-interview$/u);
    const detail = page.locator('#otklik-a-interview');
    await expect(detail.getByRole('heading', { name: 'Что дальше' })).toBeVisible();
    // B645-2: до интервью отклик ведёт в подготовку (I1); путей в разбор ещё нет.
    await expect(detail.locator('a[href*="/interview"], a[href*="/debrief"]')).toHaveCount(1);
    await expect(detail.getByRole('link', { name: 'Подготовиться к интервью' })).toHaveAttribute(
      'href',
      '/app/responses/a-interview/interview',
    );
    await expect(detail.getByText('Интервью назначено')).toBeVisible();
    await expect(detail.getByLabel('Ваша заметка')).toHaveValue(
      'Спросить про размер команды платформы.',
    );
    await expectGates(page);

    await detail.getByText('Отметить ответ').click();
    await detail.getByRole('button', { name: 'Отказали' }).click();
    await expect(detail.getByText('Отмечено: отказ').first()).toBeVisible();
    await expect(row(page, 'a-interview').locator('.tag')).toHaveText('отказ');
    expect(mock.calls.some((call) => call.includes('"rejected"'))).toBe(true);
  });

  test('B698: сообщение знакомому после «Отправил» видно в «Что было» отклика', async ({
    page,
  }) => {
    await open(page, '/app/responses', 'o01');
    await page.route('**/api/v1/candidate/b640/contact-messages/sent?*', (route) => {
      const vacancyId = new URL(route.request().url()).searchParams.get('vacancyId');
      const items =
        vacancyId === 'cluster-a-interview'
          ? [
              {
                id: 'm1',
                kind: 'known_contact',
                recipientName: 'Роман Ефимов',
                sentAt: '2026-11-06T09:00:00.000Z',
              },
            ]
          : [];
      return route.fulfill({ json: { data: { items } } });
    });
    await row(page, 'a-interview')
      .getByRole('button', { name: /Руководитель платформы/u })
      .click();
    const history = page.locator('#otklik-a-interview .od-was');
    await expect(history).toContainText('Написали знакомому');
    await expect(history).toContainText('Роман Ефимов');
  });

  test('напоминание компании: текст готов, отметка «Я напомнил»', async ({ page }) => {
    const mock = await open(page, '/app/responses/a-silent', 'o01c');
    const detail = page.locator('#otklik-a-silent');
    await expect(detail.getByLabel('Напоминание')).toHaveValue(/Маркет Софт/u);
    await detail.getByRole('button', { name: 'Я напомнил' }).click();
    await expect(detail.getByText('Отмечено: вы напомнили о себе')).toBeVisible();
    expect(mock.calls.some((call) => call.includes('follow_up_sent'))).toBe(true);
  });

  test('недоставленный отклик показывает причину и зовёт отправить ещё раз', async ({ page }) => {
    await open(page, '/app/responses/a-failed', 'o01c');
    const detail = page.locator('#otklik-a-failed');
    await expect(detail.getByRole('alert')).toContainText('Не доставлен · нужен вход в hh.ru');
    await expect(detail.getByRole('link', { name: 'Отправить ещё раз' })).toHaveAttribute(
      'href',
      '/app/responses/a-failed/letter',
    );
  });

  test('Esc сворачивает раскрытый отклик', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'клавиатура — на компьютере');
    await open(page, '/app/responses', 'o01');
    await row(page, 'a-offer')
      .getByRole('button', { name: /Руководитель разработки/u })
      .click();
    await expect(page).toHaveURL(/\/app\/responses\/a-offer$/u);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/app\/responses$/u);
  });

  test('неизвестный отклик: строка на месте и путь к списку', async ({ page }) => {
    await open(page, '/app/responses/no-such', 'o01c');
    await expect(page.getByText('Такого отклика нет')).toBeVisible();
    await expect(page.locator('tr.ot-row')).toHaveCount(7);
    await expect(page.locator('tr.ot-row').first()).toBeVisible();
  });

  test('автоотклики: счётчик дня, настройка в листе, выключение', async ({ page }) => {
    const mock = await open(page, '/app/responses', 'o01');
    const bar = page.getByRole('group', { name: 'Автоотклики' });
    await expect(bar.getByText('12 сегодня из 30')).toBeVisible();
    await bar.getByRole('button', { name: 'Настроить' }).click();
    const dialog = page.getByRole('dialog', { name: 'Настроить автоотклики' });
    await expect(dialog).toBeVisible();
    await expectGates(page, { only: ['modal_fit', 'field_height'] });
    await dialog.getByLabel('Лимит в день').fill('99');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Лимит в день');
    await dialog.getByLabel('Лимит в день').fill('40');
    await dialog.getByLabel('Engineering Manager').uncheck();
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(bar.getByText('12 сегодня из 40')).toBeVisible();
    expect(mock.calls.filter((call) => call.startsWith('PUT'))).toHaveLength(2);

    await bar.getByRole('switch').click();
    await expect(bar.getByRole('switch')).not.toBeChecked();
    await expect(bar.getByText(/сегодня из/u)).toHaveCount(0);
    expect(mock.calls.some((call) => call.endsWith('/automation/disable'))).toBe(true);
  });

  test('тариф без автооткликов: лист зовёт на Pro', async ({ page }) => {
    await open(page, '/app/responses', 'o01', { plan: 'free' });
    await page
      .getByRole('group', { name: 'Автоотклики' })
      .getByRole('button', { name: 'Настроить' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Настроить автоотклики' });
    await expect(dialog.getByText('Автоотклики на Pro')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Перейти на Pro' })).toHaveAttribute(
      'href',
      '/app/account/billing',
    );
    await expectGates(page, { only: ['modal_fit'] });
  });

  test('без согласий строка есть: включение открывает лист с согласием (B645)', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses', 'o01', { automation: false });
    await expect(page.locator('tr.ot-row')).toHaveCount(7);
    const bar = page.getByRole('group', { name: 'Автоотклики' });
    await expect(bar.getByRole('switch', { name: 'Автоотклики' })).not.toBeChecked();
    await bar.getByRole('switch', { name: 'Автоотклики' }).click();
    const sheet = page.getByRole('dialog', { name: 'Настроить автоотклики' });
    await sheet.getByRole('button', { name: 'Сохранить' }).click();
    await expect(sheet.getByText('Отметьте согласие, чтобы включить автоотклики.')).toBeVisible();
    expect(mock.calls.some((call) => call.includes('/enable'))).toBe(false);
    await sheet.getByRole('checkbox', { name: /Разрешаю готовить отклики/u }).check();
    await sheet.getByRole('button', { name: 'Сохранить' }).click();
    await expect(sheet).toBeHidden();
    await expect(bar.getByRole('switch', { name: 'Автоотклики' })).toBeChecked();
  });

  test('«Откликнулся сам — добавить» ведёт к своей вакансии (B645)', async ({ page }) => {
    await open(page, '/app/responses', 'o01');
    await expect(page.getByRole('link', { name: 'Откликнулся сам — добавить' })).toHaveAttribute(
      'href',
      '/app/vacancies?own=1',
    );
    await expect(page.getByRole('button', { name: 'Авто', exact: true })).toBeVisible();
  });

  test('откликов нет: одна строка и путь к вакансиям', async ({ page }) => {
    await open(page, '/app/responses', 'o01', { applications: [] });
    await expect(page.getByRole('heading', { name: 'Откликов пока нет' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Подобрать вакансии' })).toHaveAttribute(
      'href',
      '/app/vacancies',
    );
    await expectGates(page);
  });

  test('ошибка загрузки показана на месте, «Повторить» загружает список', async ({ page }) => {
    await open(page, '/app/responses', 'o01', { failList: 1 });
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('tr.ot-row')).toHaveCount(7);
  });

  test('воронка: числа без черновиков, напомнить компании, площадки', async ({ page }) => {
    await open(page, '/app/responses/funnel', 'o01e');
    await expect(page.getByRole('heading', { name: '1 компания пока молчит' })).toBeVisible();
    await expect(page.locator('.fv-mini')).toContainText('6 отправлено');
    await expect(page.getByRole('link', { name: 'Напомнить 1 компании' })).toHaveAttribute(
      'href',
      '/app/responses/a-silent',
    );
    await expect(page.getByRole('rowheader', { name: 'hh.ru' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'LinkedIn' })).toBeVisible();
    await expectGates(page);
  });

  test('воронка: автоотклики не входят в числа и названы в подсказке (B645)', async ({ page }) => {
    await open(page, '/app/responses/funnel', 'o01e', { autoIds: ['a-interview'] });
    await expect(page.locator('.fv-mini')).toContainText('5 отправлено');
    await expect(page.locator('.fv-mini')).toContainText('0 интервью');
    await expect(page.getByRole('button', { name: 'Что не входит в числа' })).toBeVisible();
    await expect(page.getByText(/не входят 1 автоотклик и 1 ответ на них/u)).toBeAttached();
  });

  test('разбор отказов: мало данных, отказ с догадкой, первый шаг', async ({ page }) => {
    await open(page, '/app/responses/review', 'o07');
    await expect(
      page.getByRole('heading', { name: 'Мало данных для вывода: 6 откликов' }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: '6 откликов из 20 нужных' })).toBeVisible();
    await expect(page.getByText('Сбыт Онлайн')).toBeVisible();
    await expect(page.getByText(/Вероятно, не хватило: Команда от 20 человек/u)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Обновить статусы' })).toHaveAttribute(
      'href',
      '/app/responses',
    );
    await expect(page.getByRole('heading', { name: 'Разбор помог?' })).toHaveCount(0);
    // B645, O7c: три проверки и путь к 20 откликам.
    await expect(
      page.getByRole('heading', { name: 'Три проверки, которым данные не нужны' }),
    ).toBeVisible();
    await expect(page.getByText('Незавершённых откликов — 3 из 6.')).toBeVisible();
    await expect(
      page.getByText(/В 2 из 6 вакансий верх вилки ниже ваших 500 000 ₽\./u),
    ).toBeVisible();
    await expect(page.getByText('4 из 6 откликов — позже 10 дней после публикации.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Что будет при 20 откликах' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Посмотреть вакансии' })).toHaveAttribute(
      'href',
      '/app/vacancies',
    );
    await expectGates(page);
  });

  test('разбор отказов: что сделать первым, другие рекомендации, «Разбор помог?»', async ({
    page,
  }) => {
    const mock = await open(page, '/app/responses/review', 'o07', { reviewReady: true });
    await expect(
      page.getByRole('heading', { name: 'Показать в резюме: Команда от 20 человек' }),
    ).toBeVisible();
    await expect(page.locator('.lead-text')).toContainText(
      'в профиле: руководил командой из 9 человек',
    );
    await expect(page.getByRole('link', { name: 'Открыть профиль' })).toHaveClass(/is-primary/u);
    await expect(page.locator('.rec-card')).toHaveCount(1);
    await expect(page.locator('.rec-card')).toContainText('подтверждения в профиле не нашли');
    await expectGates(page);
    await page.getByRole('button', { name: 'Да', exact: true }).click();
    await expect(page.getByText('Спасибо, ответ записан')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Да', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(mock.calls).toContain('PUT feedback true');
  });

  test('«Поправить резюме»: готовая правка у консультанта, пишет её кандидат (o07 → k06)', async ({
    page,
  }, info) => {
    const options = { reviewReady: true, resumeFact: true };
    const mock = await open(page, '/app/responses/review', 'o07', options);
    await expectGates(page);
    await page.getByRole('button', { name: 'Поправить резюме' }).click();
    const panel = page.getByRole('dialog', { name: 'Консультант · Резюме' });
    const card = panel.locator('.ec');
    await expect(card.locator('.now dd')).toHaveText(RESUME_BULLET);
    await card.scrollIntoViewIfNeeded();
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/k06-${info.project.name}.png` });
    }
    expect(mock.calls).toEqual([]);
    await card.getByRole('button', { name: 'Применить' }).click();
    await expect(panel.getByText('Применено', { exact: true })).toBeVisible();
    expect(mock.calls).toEqual(['apply e1#0']);
    await panel.getByRole('button', { name: 'Отменить' }).click();
    await expect(card).toBeVisible();
    expect(mock.calls).toEqual(['apply e1#0', 'revert']);
  });

  test('отказ в раскрытом отклике: догадка и отметка «чего не хватило»', async ({ page }) => {
    const mock = await open(page, '/app/responses/a-rejected', 'o01c');
    const detail = page.locator('#otklik-a-rejected');
    await expect(detail.getByText(/Вероятно, не хватило: Команда от 20 человек/u)).toBeVisible();
    await detail.getByRole('button', { name: 'Отметить, чего не хватило' }).click();
    await expect(detail.getByRole('alert')).toContainText('Выберите');
    await detail.getByRole('button', { name: 'Деньги' }).click();
    await detail.getByLabel(/Что написали/u).fill('Вилка ниже ожиданий');
    await detail.getByRole('button', { name: 'Отметить, чего не хватило' }).click();
    await expect(detail.getByText('Отмечено', { exact: true })).toBeVisible();
    expect(mock.calls).toContain('PUT reason money Вилка ниже ожиданий');
    await expectGates(page);
  });

  test('хочу в компанию: статусы, фильтр, добавление', async ({ page }) => {
    const mock = await open(page, '/app/responses/wanted', 'o08');
    await expect(page.locator('.cw-row')).toHaveCount(4);
    await expect(page.locator('.cw-row').first().locator('.tag')).toHaveText('новые вакансии');
    await expect(
      page
        .locator('.cw-row')
        .first()
        .getByRole('link', { name: /Смотреть вакансии/u }),
    ).toHaveAttribute('href', '/app/vacancies');
    await expect(page.locator('.cw-row a[href^="/app/vacancies/companies"]')).toHaveCount(0);
    // B645: действие строки — цель 44 px и 14px/600, как a.btn в макете.
    const action = await page
      .locator('.cw-act .btn')
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return [Math.round(node.getBoundingClientRect().height), style.fontSize, style.fontWeight];
      });
    expect(action).toEqual([44, '14px', '600']);
    await page.getByRole('button', { name: 'Жду вакансию · 1' }).click();
    await expect(page.locator('.cw-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Все · 4' }).click();
    await expectGates(page);

    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Введите название');
    await page.getByLabel('Добавить компанию').fill('Северсталь');
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(page.getByText('Северсталь — в списке')).toBeVisible();
    await expect(page.locator('.cw-row')).toHaveCount(5);
    expect(mock.calls).toContain('PUT company-wants Северсталь');
  });

  test('компаний нет: поле добавления с главной кнопкой', async ({ page }) => {
    await open(page, '/app/responses/wanted', 'o08', { companies: [] });
    await expect(page.getByRole('heading', { name: 'Компаний пока нет' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить компанию' })).toHaveClass(
      /is-primary/u,
    );
    await expectGates(page);
  });

  test('снимки раздела для сверки с макетами', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const desktop = testInfo.project.name === 'desktop-1440';
    const widths = desktop ? [1440, 1176] : [390];
    await mockResponses(page);
    await page.goto('/app/responses', { waitUntil: 'domcontentloaded' });
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      for (const [name, path, node] of [
        ['o01-otkliki', '/app/responses', 'o01'],
        ['o01c-otklik-raskryt', '/app/responses/a-interview', 'o01c'],
        ['o01e-voronka', '/app/responses/funnel', 'o01e'],
        ['o07-razbor', '/app/responses/review', 'o07'],
        ['o08-hochu-v-kompaniyu', '/app/responses/wanted', 'o08'],
      ] as const) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator(`[data-b640-node="${node}"]`)).toBeVisible();
        await expect(page.locator('.ls-state')).toHaveCount(0);
        for (const width of widths) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    }
  });
});
