import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const ROWS = '.b640 table.vt tbody tr.vt-row';

async function openCabinet(
  page: Page,
  path: string,
  options: { readonly hidden?: readonly unknown[] } = {},
): Promise<void> {
  await mockSignedInCabinet(page, {
    cabinetB640: true,
    vacancyTotal: 45,
    vacancyFacets: {
      total: 45,
      regions: [],
      remote: 0,
      levels: [],
      roles: [{ role: 'Руководитель продукта', count: 12 }],
      sources: [],
    } as never,
  });
  const hidden = options.hidden ?? [];
  await page.route('**/api/v1/candidate/b640/hidden-vacancies**', (route) =>
    route.fulfill({
      json: {
        data: hidden,
        meta: { total: hidden.length, offset: 0, limit: 20, nextOffset: null },
      },
    }),
  );
  await page.route('**/api/v1/candidate/vacancy-skips**', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 201, json: { data: { clusterId: 'x', reasonId: 'role-family' } } })
      : route.fulfill({ status: 200, json: { data: { ok: true } } }),
  );
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-b640-node]').first()).toBeVisible({ timeout: 15_000 });
}

function isMobile(project: string): boolean {
  return project === 'mobile-390';
}

async function openHide(page: Page, mobile: boolean): Promise<void> {
  const row = page.locator(ROWS).first();
  if (mobile) {
    await row.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Не подходит' }).click();
  } else {
    await row.getByRole('button', { name: 'Не подходит' }).click();
  }
}

const HIDDEN_ROW = {
  cluster: {
    id: 'hid-1',
    canonicalTitle: 'Руководитель разработки',
    canonicalCompany: 'Кредит Онлайн',
    canonicalLocation: 'Москва',
    isRemote: false,
    primaryUrl: 'https://example.com/careers',
    firstObservedAt: '2026-11-10T09:00:00Z',
    sources: [{ sourceId: 'hh', observedAt: '2026-11-10T09:00:00Z' }],
    companyFeatures: {},
  },
  explanation: { summary: '', calculatedAt: '2026-11-10T09:00:00Z' },
  hidden: { reasonId: 'comp-below', at: '2026-11-11T09:00:00Z' },
};

async function showHidden(page: Page, mobile: boolean): Promise<void> {
  if (mobile) await page.getByRole('button', { name: /^Фильтры/ }).click();
  else
    await page
      .getByRole('button', { name: /^Роли|^Все роли/ })
      .first()
      .click();
  await page.getByRole('button', { name: 'Показать скрытые' }).click();
  // На 390 лист фильтров закрывает кнопка «Показать N» в его шапке.
  if (mobile) await page.locator('.vt-sheet-go').click();
  else await page.locator('.vt-pop-foot .btn.is-primary').click();
}

interface TriageBody {
  readonly clusterIds: readonly string[];
  readonly answers?: Record<string, boolean>;
}

/** Разбор: три первые строки скрыть, четвёртая ждёт ответа про зарплату, остальные подходят. */
function triageRows(ids: readonly string[], yes: boolean) {
  const hide = (clusterId: string, reasonId: string, reasonLabel: string) => ({
    clusterId,
    verdict: 'hide',
    reasonId,
    reasonLabel,
  });
  return ids.map((id, index) => {
    if (index === 0) return hide(id, 'role-family', 'не та роль');
    if (index === 1) return hide(id, 'level', 'не тот уровень');
    if (index === 2) return hide(id, 'geo-format', 'не те условия');
    if (index !== 3) return { clusterId: id, verdict: 'keep' };
    return yes
      ? hide(id, 'comp-below', 'зарплата ниже')
      : { clusterId: id, verdict: 'needs_data', questionId: 'salaryLowerBound' };
  });
}

async function mockTriage(page: Page): Promise<TriageBody[]> {
  const calls: TriageBody[] = [];
  await page.route('**/api/v1/candidate/b640/vacancy-triage', (route) => {
    const body = route.request().postDataJSON() as TriageBody;
    calls.push(body);
    const yes = body.answers?.salaryLowerBound === true;
    const rows = triageRows(body.clusterIds, yes);
    const count = (verdict: string) => rows.filter((row) => row.verdict === verdict).length;
    return route.fulfill({
      json: {
        data: {
          rows,
          questions: yes
            ? []
            : [{ id: 'salaryLowerBound', text: 'Сравнивать по нижней границе зарплаты?' }],
          questionTotal: 1,
          summary: {
            total: rows.length,
            keep: count('keep'),
            hide: count('hide'),
            needsData: count('needs_data'),
          },
        },
        meta: { requestId: 'triage-1' },
      },
    });
  });
  return calls;
}

const PICKED = `${ROWS}.is-pick`;
const PRIMARY = '.vz-bar .btn.is-primary';

test.describe('B654: раздел «Вакансии», подборка и сохранённые', () => {
  test('таблица подборки видна, порции по 20, гейты макетов', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    await expect(page.locator('[data-b640-node="s07"]')).toBeVisible();
    await expect(page.locator(ROWS).first()).toBeVisible();
    await expect(page.locator(ROWS)).toHaveCount(20);
    await expect(page.locator('.vl-foot .btn')).toContainText('Показать ещё 20');
    await page.locator('.vl-foot .btn').click();
    await expect(page.locator(ROWS)).toHaveCount(40);
    await expectGates(page);
  });

  test('фильтр локаций меняет число вакансий, «Сбросить всё» возвращает', async ({
    page,
  }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    await openCabinet(page, '/app/vacancies');
    const count = page.locator('.vl-count .num');
    await expect(count).toBeVisible();
    const before = Number(await count.innerText());
    await page.getByRole('button', { name: /^Локации/ }).click();
    await expect(page.getByRole('dialog', { name: /Фильтры/ })).toBeVisible();
    await page.locator('.vt-pop .vt-opt input').first().check();
    const after = Number(await count.innerText());
    expect(after).toBeLessThan(before);
    await page.locator('.vt-pop-foot .btn.is-primary').click();
    await expect(page.locator('.vt-pop')).toHaveCount(0);
    await page.locator('.vt-chips').getByRole('button', { name: 'Сбросить всё' }).click();
    await expect(count).toHaveText(String(before));
  });

  test('вкладка «Роли» показывает роли с числом вакансий', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    await openCabinet(page, '/app/vacancies');
    await page.getByRole('button', { name: /^Все роли/ }).click();
    await expect(
      page.locator('.vt-pop .vt-opt', { hasText: 'Руководитель продукта' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.vt-pop')).toHaveCount(0);
  });

  test('390: лист фильтров — диалог, Esc закрывает', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo.project.name), 'только телефон');
    await openCabinet(page, '/app/vacancies');
    await page.getByRole('button', { name: /^Фильтры · / }).click();
    const sheet = page.getByRole('dialog', { name: 'Фильтры' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('скрыть с причиной: строка уходит, «Отменить» возвращает', async ({ page }, testInfo) => {
    await openCabinet(page, '/app/vacancies');
    const first = await page.locator(`${ROWS} .vt-toggle`).first().getAttribute('title');
    await openHide(page, isMobile(testInfo.project.name));
    await page.getByRole('radio', { name: 'Зарплата ниже ожиданий' }).check();
    await page.getByRole('button', { name: 'Скрыть', exact: true }).click();
    await expect(page.locator('.va-snack')).toContainText('Скрыто');
    await expect(page.locator(`${ROWS} .vt-toggle`).first()).not.toHaveAttribute(
      'title',
      first ?? '',
    );
    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.locator(`${ROWS} .vt-toggle`).first()).toHaveAttribute('title', first ?? '');
  });

  test('«уже откликнулись»: неверная дата — ошибка, верная — метка в строке', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    const row = page.locator(ROWS).first();
    await row.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Уже откликнулись' }).click();
    const date = page.getByLabel('Дата', { exact: true });
    await date.fill('31.13');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByText('Нет такой даты')).toBeVisible();
    await date.fill('05.11');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.locator(ROWS).first().locator('.va-tag.ok')).toBeVisible();
  });

  test('☆ сохраняет вакансию, она видна в «Сохранённых»', async ({ page }) => {
    await openCabinet(page, '/app/vacancies/saved');
    await expect(page.locator('.st-var-line')).toContainText('Сохранённых вакансий нет');
    await page.getByRole('link', { name: 'Перейти в подборку' }).click();
    await expect(page.locator('[data-b640-node="s07"]')).toBeVisible();
    const star = page.locator(ROWS).first().getByRole('button', { name: 'Сохранить вакансию' });
    await star.click();
    await expect(
      page.locator(ROWS).first().getByRole('button', { name: 'Убрать из сохранённых' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/app/vacancies/saved', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="v06s"]')).toBeVisible();
    await expect(page.locator(ROWS)).toHaveCount(1);
    await expect(page.locator('.vl-count')).toContainText('1 сохранённая вакансия');
    await expectGates(page);
  });

  test('раскрытая строка: сводка и кнопки, одна раскрытая за раз', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    const toggles = page.locator(`${ROWS} .vt-toggle`);
    await toggles.nth(0).click();
    await expect(page.locator('.vt-detail-row .vs')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Откликнуться' })).toBeVisible();
    await toggles.nth(1).click();
    await expect(page.locator('.vt-detail-row .vs')).toHaveCount(1);
  });

  test('«Показать скрытые»: строка с меткой, «Вернуть в подборку» убирает её', async ({
    page,
  }, testInfo) => {
    const mobile = isMobile(testInfo.project.name);
    await openCabinet(page, '/app/vacancies', { hidden: [HIDDEN_ROW] });
    await showHidden(page, mobile);
    const hidden = page.locator('tbody.vt-hid tr.vt-row.is-hid');
    await expect(hidden).toHaveCount(1);
    await expect(hidden.locator('.va-hid')).toHaveText('скрыто');
    await expect(hidden.locator('[role="tooltip"]')).toHaveText(
      'Скрыто 11.11 · Зарплата ниже ожиданий',
    );
    await expectGates(page);
    await hidden.getByRole('button', { name: 'Ещё действия' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Вернуть в подборку' }).click();
    await expect(page.getByText('Скрытых вакансий нет')).toBeVisible();
  });

  test('снимки подборки и сохранённых для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const width = isMobile(testInfo.project.name) ? 390 : 1440;
    await openCabinet(page, '/app/vacancies');
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      for (const [name, path] of [
        ['vacancies-list', '/app/vacancies'],
        ['vacancies-saved', '/app/vacancies/saved'],
      ] as const) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-b640-node]').first()).toBeVisible();
        await page.screenshot({ path: `.s13-shots/${name}-${width}-${theme}.png` });
      }
    }
  });
  test('«Помочь выбрать»: отмеченные строки, вопрос, скрытие серией и «Отменить»', async ({
    page,
  }) => {
    await openCabinet(page, '/app/vacancies');
    const calls = await mockTriage(page);
    const skips: string[] = [];
    await page.route('**/api/v1/candidate/vacancy-skips', (route) => {
      skips.push(route.request().method());
      return route.fulfill({ status: 201, json: { data: { clusterId: 'x', reasonId: 'x' } } });
    });
    const first = await page.locator(`${ROWS} .vt-toggle`).first().getAttribute('title');

    await page.locator('.va-review').click();
    await expect(page.locator('.va-review')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('section.is-triage')).toBeVisible();
    await expect(page.locator(PICKED)).toHaveCount(3);
    await expect(page.locator(`${PICKED} .vz-why`).first()).toHaveText('не та роль');
    await expect(page.locator(`${PICKED} .vz-ck`).first()).toBeChecked();
    await expect(page.locator('.vz-q1-n')).toHaveText('1 из 1');
    await expect(page.locator(PRIMARY)).toContainText('3');
    await expect(page.locator(PRIMARY)).toBeEnabled();
    expect(calls[0]?.clusterIds.length).toBeGreaterThan(20);
    await expectGates(page);

    await page.locator('.vz-q1-a').getByRole('button', { name: 'Да' }).click();
    await expect(page.locator(PRIMARY)).toContainText('4');
    await expect(page.locator('.vz-q1')).toHaveCount(0);
    expect(calls[1]?.answers).toEqual({ salaryLowerBound: true });

    await page.locator(PRIMARY).click();
    await expect(page.locator('.va-snack')).toContainText('Скрыто');
    await expect(page.locator('.vz-bar')).toHaveCount(0);
    expect(skips.filter((method) => method === 'POST')).toHaveLength(4);
    await expect(page.locator(`${ROWS} .vt-toggle`).first()).not.toHaveAttribute(
      'title',
      first ?? '',
    );

    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect(page.locator(`${ROWS} .vt-toggle`).first()).toHaveAttribute('title', first ?? '');
  });

  test('«Помочь выбрать»: снятый флажок уменьшает счётчик, «Отмена» ничего не меняет', async ({
    page,
  }) => {
    await openCabinet(page, '/app/vacancies');
    await mockTriage(page);
    await page.locator('.va-review').click();
    await expect(page.locator(PRIMARY)).toContainText('3');
    await page.locator(`${PICKED} .vz-ck`).first().uncheck();
    await expect(page.locator(PRIMARY)).toContainText('2');
    await page.locator('.vz-bar').getByRole('button', { name: 'Отмена' }).click();
    await expect(page.locator('.vz-bar')).toHaveCount(0);
    await expect(page.locator('.va-review')).not.toHaveAttribute('aria-current', 'true');
    await expect(page.locator(ROWS)).toHaveCount(20);
  });

  test('«Помочь выбрать»: сбой разбора — строка с «Повторить», режим остаётся', async ({
    page,
  }) => {
    await openCabinet(page, '/app/vacancies');
    await page.route('**/api/v1/candidate/b640/vacancy-triage', (route) =>
      route.fulfill({ status: 500, json: { error: { message: 'сбой' } } }),
    );
    await page.locator('.va-review').click();
    await expect(page.locator('.vl-err')).toContainText('Не удалось разобрать подборку');
    await expect(page.locator('.vz-bar')).toBeVisible();
    await expect(page.locator('.vl-err').getByRole('button', { name: 'Повторить' })).toBeVisible();
  });

  test('снимки режима «Помочь выбрать» для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const width = isMobile(testInfo.project.name) ? 390 : 1440;
    await openCabinet(page, '/app/vacancies');
    await mockTriage(page);
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
      await page.goto('/app/vacancies', { waitUntil: 'domcontentloaded' });
      await page.locator('.va-review').click();
      await expect(page.locator(PICKED).first()).toBeVisible();
      await expect(page.locator(PRIMARY)).toBeEnabled();
      // Кнопка меняет цвет плавно: снимок — после перехода.
      await page.waitForTimeout(400);
      await page.screenshot({ path: `.s13-shots/vacancies-triage-${width}-${theme}.png` });
    }
  });
});
