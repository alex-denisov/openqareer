import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openCareer, type CareerOptions } from './careerFixture';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
/** Узел адреса без варианта или вариант экрана (s10 на корне при «Ищу, кем работать», c10). */
const node = (page: Page, code: string) =>
  page.locator(`[data-b640-node="${code}"]:not([data-b640-state]), [data-b640-state="${code}"]`);
const desk = (page: Page) => page.viewportSize()!.width >= 768;

/** B645 s09: строка источников под зарплатой не выходит за свою ячейку. */
async function expectWageNotesInsideCells(page: Page): Promise<void> {
  const overflow = await page.locator('.c9-table td .c9-n').evaluateAll((notes) =>
    notes
      .map((note) => {
        const cell = note.closest('td')!.getBoundingClientRect();
        // Блок занимает ширину ячейки; вылезает текст — меряем его диапазон.
        const range = document.createRange();
        range.selectNodeContents(note);
        const box = range.getBoundingClientRect();
        return { text: note.textContent, over: Math.round(box.right - cell.right) };
      })
      .filter((row) => row.over > 0),
  );
  expect(overflow).toEqual([]);
}

test.describe('B653: «Карьера» — роли и условия поиска', () => {
  test('S9: роль поиска, проверка навыков, роли по профилю, «Показать все»; гейты', async ({
    page,
  }) => {
    await openCareer(page, '/app/career');
    const screen = node(page, 's09');
    await expect(screen.locator('#role-title')).toHaveText('Руководитель разработки');
    await expect(screen.getByText('64 вакансии · по подборке за 30 дней')).toBeVisible();
    await expect(screen.getByText('Проверьте 3 навыка — точнее подбор')).toBeVisible();
    await expect(
      screen.getByRole('heading', { name: /Роли по вашему профилю · 5/u }),
    ).toBeVisible();
    const list = desk(page) ? screen.locator('.c9-table tbody tr') : screen.locator('.c9-acc');
    await expect(list).toHaveCount(3);
    await expect(screen.getByText('Показаны 3 из 5')).toBeVisible();
    if (desk(page)) await expectWageNotesInsideCells(page);
    await expectGates(page);
    // Гейты меняют размер окна: курсор мог остаться над ⓘ, и подсказка закрывает строки.
    await page.mouse.move(0, 0);
    await screen.getByRole('button', { name: 'Показать все 5' }).click();
    await expect(list).toHaveCount(5);
    if (desk(page)) {
      await expect(list.first()).toContainText('380–520 тыс. ₽hh.ru, 96 вакансий, 10.11');
      await expect(list.first()).toContainText('роль поиска');
      // B726: ссылка несёт роль и «Дату: 30 дней» в «Подборку» — строки числа роли.
      await expect(
        screen.getByRole('link', { name: 'Вакансии по роли «Руководитель разработки»' }),
      ).toHaveAttribute(
        'href',
        '/app/vacancies?role=%D0%A0%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D0%B8%D1%82%D0%B5%D0%BB%D1%8C+%D1%80%D0%B0%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D0%B8&date=30',
      );
      await expect(list.last()).toContainText('нет данных о зарплатах');
      await expect(list.nth(2)).toContainText('Открытый API и ещё 2');
      await expectWageNotesInsideCells(page);
    }
  });

  test('B737: роль поиска на английском — по-русски в полосе и в выборе ролей', async ({
    page,
  }) => {
    await openCareer(page, '/app/career', {
      searchRoles: ['Chief Operating Officer'],
      titlesRu: { 'Chief Operating Officer': 'Операционный директор (COO)' },
    });
    const screen = node(page, 's09');
    await expect(screen.locator('#role-title')).toHaveText('Операционный директор (COO)');
    await screen.getByRole('button', { name: 'Показать все 6' }).click();
    const rows = desk(page) ? screen.locator('.c9-table tbody tr') : screen.locator('.c9-acc');
    await expect(rows.last()).toContainText('Операционный директор (COO)');
    await expect(page.getByText('Chief Operating Officer')).toHaveCount(0);
  });

  test('S9: крестик скрывает предложение, «Отменить» возвращает', async ({ page }) => {
    await openCareer(page, '/app/career');
    const strip = page.locator('.sk-strip');
    await strip.getByRole('button', { name: 'Скрыть предложение' }).click();
    await expect(strip).toHaveCount(0);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(strip).toBeVisible();
  });

  test('S9c: роли поиска — отметить вторую, «Искать» сохраняет и ведёт к вакансиям', async ({
    page,
  }) => {
    const calls = await openCareer(page, '/app/career');
    await node(page, 's09').getByRole('button', { name: 'Изменить' }).click();
    const dialog = page.getByRole('dialog', { name: 'Роли поиска' });
    await expect(dialog.getByLabel(/Руководитель разработки/u)).toBeChecked();
    await expectGates(page, { only: ['modal_fit'] });
    await dialog.getByLabel(/Директор по разработке/u).check();
    await dialog.getByRole('button', { name: 'Искать в 2 ролях' }).click();
    await expect(page).toHaveURL(/\/app\/vacancies$/u);
    expect(calls.campaigns).toEqual([
      expect.objectContaining({ roles: ['Руководитель разработки', 'Директор по разработке'] }),
    ]);
  });

  test('S9c: снять все отметки — искать нечего; «Сравнить роли» ведёт на S10', async ({ page }) => {
    await openCareer(page, '/app/career');
    await node(page, 's09').getByRole('button', { name: 'Изменить' }).click();
    const dialog = page.getByRole('dialog', { name: 'Роли поиска' });
    await dialog.getByLabel(/Руководитель разработки/u).uncheck();
    await expect(dialog.getByRole('button', { name: 'Искать' })).toBeDisabled();
    await dialog.getByRole('link', { name: 'Сравнить роли' }).click();
    await expect(node(page, 's10').getByRole('heading', { level: 2 })).toHaveText(
      'Ближе всего — Руководитель разработки',
    );
  });

  test('S10 на корне при «Ищу, кем работать»: сравнение, проверка навыков, свои роли; гейты', async ({
    page,
  }) => {
    const options: CareerOptions = { status: 'choosing_role', searchRoles: [] };
    const calls = await openCareer(page, '/app/career', options);
    const screen = node(page, 's10');
    await expect(screen).toHaveAttribute('data-b640-node', 's09');
    if (desk(page)) {
      await expect(screen.locator('table.cmp thead .r2-pick')).toHaveCount(3);
      await expect(screen.locator('table.cmp')).toContainText('пройдена · 3 из 3');
      await expect(screen.locator('table.cmp')).toContainText('не начата');
      // B645-2: столбцы ролей равной ширины (WebKit делил их неровно).
      const widths = await screen
        .locator('table.cmp thead th[scope="col"]')
        .evaluateAll((cells) => cells.slice(1).map((cell) => cell.getBoundingClientRect().width));
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    }
    // B645-2: «Как посчитано» на строке последнего слова заголовка, не отдельной строкой
    // (на 1440 заголовок фикстуры в одну строку; на 390 значок переносится, только если не влезает).
    const head = await screen
      .locator('.lead-head')
      .first()
      .evaluate((el) => {
        const title = el.querySelector('.lead-title')!.getClientRects();
        const tip = el.querySelector('.tip')!.getBoundingClientRect();
        const last = title[title.length - 1];
        return { tipMid: tip.top + tip.height / 2, top: last.top, bottom: last.bottom };
      });
    if (desk(page)) {
      expect(head.tipMid).toBeGreaterThanOrEqual(head.top);
      expect(head.tipMid).toBeLessThanOrEqual(head.bottom);
    }
    await expectGates(page);
    // Гейты меняют размер окна: курсор мог остаться над ⓘ, и подсказка закрывает строки.
    await page.mouse.move(0, 0);
    await screen.getByRole('button', { name: 'Назвать свою роль' }).click();
    await screen.getByLabel('Своя роль').fill('Архитектор решений');
    await screen.getByRole('button', { name: 'Добавить роль' }).click();
    await expect(screen.getByText('Роль добавлена в поиск')).toBeVisible();
    expect(calls.ownRoles).toEqual([{ action: 'add', title: 'Архитектор решений' }]);
  });

  test('B764: «Проверить вторую роль» не называет роль — C04 сам берёт роль, проверку которой можно начать', async ({
    page,
  }) => {
    await openCareer(page, '/app/career/roles', {
      searchRoles: ['Технический продакт-менеджер', 'Директор по разработке'],
    });
    const link = node(page, 's10').getByRole('link', { name: 'Проверить вторую роль' });
    await expect(link).toHaveAttribute('href', '/app/career/skills');
  });

  test('B764: проверка под другим названием — строка называет её роль и счёт, ссылка ведёт к прогону', async ({
    page,
  }) => {
    await openCareer(page, '/app/career/roles', {
      searchRoles: ['Директор по разработке', 'Руководитель разработки'],
      roleAliases: { 'Директор по разработке': ['Head of Engineering'] },
      checkedRoles: [
        {
          roleTitle: 'Head of Engineering',
          roleTitleRu: 'Руководитель направления разработки',
          completedAt: '2026-11-22',
          confirmedSkills: ['Найм', 'Бюджет', 'Управление командой'],
          skillCount: 5,
        },
      ],
    });
    const tag = node(page, 's10')
      .getByRole('link', { name: 'пройдена для «Руководитель направления разработки» · 3 из 5' })
      .first();
    await expect(tag).toHaveAttribute('href', '/app/career/skills?role=Head%20of%20Engineering');
  });

  test('S10: «Искать в роли» сохраняет отмеченную роль', async ({ page }) => {
    const calls = await openCareer(page, '/app/career/roles', { searchRoles: [] });
    await node(page, 's10')
      .getByRole('button', { name: 'Искать в роли Руководитель разработки' })
      .click();
    await expect(page).toHaveURL(/\/app\/vacancies$/u);
    expect(calls.campaigns).toEqual([
      expect.objectContaining({ roles: ['Руководитель разработки'] }),
    ]);
  });

  test('C10: зарплата сохраняется на месте, «Отменить» возвращает прежнюю; гейты', async ({
    page,
  }) => {
    const calls = await openCareer(page, '/app/career');
    await node(page, 's09').getByRole('link', { name: 'Условия поиска' }).click();
    const screen = node(page, 'c10');
    await expect(screen.getByText('Москва, удалённо из РФ')).toBeVisible();
    await expect(screen.getByText('гибрид, удалённо')).toBeVisible();
    await expectGates(page);
    // Гейты меняют размер окна: курсор мог остаться над ⓘ, и подсказка закрывает строки.
    await page.mouse.move(0, 0);
    await screen.getByRole('button', { name: 'Изменить: Зарплата от' }).click();
    const field = screen.getByLabel('Зарплата от, ₽ в месяц на руки');
    await expect(field).toHaveValue('500 000');
    await field.fill('пятьсот');
    await screen.getByRole('button', { name: 'Сохранить' }).click();
    await expect(screen.getByText('Введите сумму цифрами')).toBeVisible();
    await field.fill('550 000');
    await screen.getByRole('button', { name: 'Сохранить' }).click();
    await expect(screen.getByText('550 000 ₽ на руки')).toBeVisible();
    await expect(screen.getByText('Сохранено · подборка обновится')).toBeVisible();
    await screen.getByRole('button', { name: 'Отменить' }).click();
    await expect(screen.getByText('500 000 ₽ на руки')).toBeVisible();
    expect(calls.profiles.map((profile) => profile.salaryFloor)).toEqual([550_000, 500_000]);
    // «Отменить» вернул только зарплату: остальные поля профиля те же, что после правки.
    expect({ ...calls.profiles[1], salaryFloor: 0 }).toEqual({
      ...calls.profiles[0],
      salaryFloor: 0,
    });
    expect(calls.profiles[0]).toMatchObject({ citizenship: ['РФ'] });
  });

  test('C10 по макету: страница настроек 640 по центру, а не шаблон «Ролей» (B645-2)', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', 'замер макета снят на 1440');
    await openCareer(page, '/app/career?view=conditions');
    await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-template', 'settings');
    // Макет c10-usloviya-poiska на 1440: страница 720 с x398, колонка условий 640 с x438.
    const pageBox = await node(page, 'c10').boundingBox();
    const column = await node(page, 'c10').locator('.lead.cc').boundingBox();
    expect([pageBox?.x, pageBox?.width].map((value) => Math.round(value ?? 0))).toEqual([398, 720]);
    expect([column?.x, column?.width].map((value) => Math.round(value ?? 0))).toEqual([438, 640]);
  });

  test('C10: сбой сохранения — ошибка на месте, введённое осталось', async ({ page }) => {
    const calls = await openCareer(page, '/app/career?view=conditions', { failProfileSave: true });
    const screen = node(page, 'c10');
    await screen.getByRole('button', { name: 'Изменить: Формат' }).click();
    await screen.getByLabel('Офис').check();
    await screen.getByRole('button', { name: 'Сохранить' }).click();
    await expect(screen.getByRole('alert')).toContainText('Не сохранилось');
    await expect(screen.getByLabel('Офис')).toBeChecked();
    expect(calls.profiles).toEqual([]);
    await expect(screen.locator('.cc-row', { hasText: 'Формат' }).locator('.cc-v')).toHaveText(
      'гибрид, удалённо',
    );
  });

  test('C10: стоп-лист — добавить компанию и убрать прежнюю', async ({ page }) => {
    const calls = await openCareer(page, '/app/career?view=conditions');
    const screen = node(page, 'c10');
    await screen.getByRole('button', { name: 'Изменить: Стоп-лист' }).click();
    await screen.getByLabel('Гринкод').uncheck();
    await screen.getByLabel('Компания').fill('Ладога Банк');
    await screen.getByRole('button', { name: 'Добавить в стоп-лист' }).click();
    await screen.getByRole('button', { name: 'Сохранить' }).click();
    const row = screen.locator('.cc-row', { hasText: 'Стоп-лист' }).locator('.cc-v');
    await expect(row).toHaveText('Ладога Банк');
    expect(calls.stopAdded).toEqual(['Ладога Банк']);
    expect(calls.stopRemoved).toEqual(['Гринкод']);
  });

  test('C10: география — место из справочника', async ({ page }) => {
    const calls = await openCareer(page, '/app/career?view=conditions');
    const screen = node(page, 'c10');
    await screen.getByRole('button', { name: 'Изменить: География' }).click();
    await screen.getByLabel('Город, страна или удалённо').fill('Казань');
    await screen
      .getByRole('button', { name: /^Казань/u })
      .first()
      .click();
    await screen.getByRole('button', { name: 'Сохранить' }).click();
    await expect(screen.getByText(/Москва, удалённо из РФ, Казань/u)).toBeVisible();
    expect(calls.profiles[0]?.searchLocations).toHaveLength(3);
  });

  const SCREENS: ReadonlyArray<readonly [string, string, CareerOptions]> = [
    ['s09-karera-ishchu', '/app/career', {}],
    ['s10-karera-ishchu-kem', '/app/career/roles', { searchRoles: [] }],
    ['c10-usloviya-poiska', '/app/career?view=conditions', {}],
  ];

  for (const [name, path, options] of SCREENS) {
    test(`снимки: ${name}`, async ({ page }, testInfo) => {
      test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
      mkdirSync('.s13-shots', { recursive: true });
      const desktop = testInfo.project.name === 'desktop-1440';
      const widths = desktop ? [1440, 1176] : [390];
      await openCareer(page, path, options);
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
        await expect(
          page.locator('.b640 [data-b640-node] .lead, .b640 [data-b640-node] .mod').first(),
        ).toBeVisible();
        for (const width of widths) {
          await page.setViewportSize({ width, height: desktop ? 900 : 844 });
          await page.screenshot({
            path: `.s13-shots/${name}-${width}-${theme}.png`,
            fullPage: true,
          });
        }
      }
    });
  }
});
