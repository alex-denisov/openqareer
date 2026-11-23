import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const ROWS = '.b640 table.vt tbody tr.vt-row';

async function openCabinet(
  page: Page,
  path: string,
  options: {
    readonly hidden?: readonly unknown[];
    readonly total?: number;
    readonly own?: readonly unknown[];
    readonly campaignRoles?: readonly string[];
    readonly titlesRu?: Readonly<Record<string, string>>;
    readonly skillGap?: number;
  } = {},
): Promise<void> {
  await mockSignedInCabinet(page, {
    cabinetB640: true,
    vacancyTotal: options.total ?? 45,
    ...(options.campaignRoles ? { vacancyCampaignRoles: options.campaignRoles } : {}),
    ...(options.titlesRu ? { vacancyCampaignTitlesRu: options.titlesRu } : {}),
    ...(options.skillGap !== undefined ? { roleSkillGap: options.skillGap } : {}),
    vacancyFacets: {
      total: options.total ?? 45,
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
  const own = options.own ?? [];
  await page.route('**/api/v1/candidate/b640/own-vacancies', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { data: own, meta: { requestId: 'own' } } })
      : route.fallback(),
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
  readonly clusterIds?: readonly string[];
  /** Разбор всей подборки: строка фильтров списка вместо списка id. */
  readonly query?: string;
  readonly answers?: Record<string, boolean>;
}

/**
 * Вся подборка глазами сервера: первые id — настоящие строки первой порции, остальные клиент
 * ещё не дочитал.
 */
async function poolIds(page: Page, size: number): Promise<string[]> {
  const first = await page.evaluate(async () => {
    const response = await fetch('/api/v1/candidate/matched-vacancies?offset=0');
    const body = (await response.json()) as { data: Array<{ cluster: { id: string } }> };
    return body.data.map((item) => item.cluster.id);
  });
  const unread = Array.from(
    { length: Math.max(0, size - first.length) },
    (_, index) => `unread-${index}`,
  );
  return [...first, ...unread].slice(0, size);
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

async function mockTriage(page: Page, poolSize = 45): Promise<TriageBody[]> {
  const calls: TriageBody[] = [];
  await page.route('**/api/v1/candidate/b640/vacancy-triage', async (route) => {
    const body = route.request().postDataJSON() as TriageBody;
    calls.push(body);
    const yes = body.answers?.salaryLowerBound === true;
    const rows = triageRows(body.clusterIds ?? (await poolIds(page, poolSize)), yes);
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

  test('B760: строки подборки не ждут чтения рабочего пространства', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    // Рабочее пространство нужно только прежней оболочке: новый кабинет его не ждёт.
    let workspaceAnswered = false;
    await page.route('**/api/v1/candidate/workspace', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      workspaceAnswered = true;
      return route.fallback();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(ROWS).first()).toBeVisible({ timeout: 3_000 });
    expect(workspaceAnswered).toBe(false);
  });
  test('B760: код кабинета грузится рядом с /auth/me на устройстве, где кабинет уже открывался', async ({
    page,
  }) => {
    await openCabinet(page, '/app/vacancies');
    let authAnswered = false;
    let chunkBeforeAuth = false;
    await page.route('**/api/v1/auth/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      authAnswered = true;
      return route.fallback();
    });
    page.on('request', (request) => {
      if (/\/assets\/CabinetB640-[^/]+\.js$/u.test(request.url()) && !authAnswered)
        chunkBeforeAuth = true;
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(ROWS).first()).toBeVisible();
    expect(chunkBeforeAuth).toBe(true);
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

  test('B728: число у периода «Даты» = число списка после выбора', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    await openCabinet(page, '/app/vacancies');
    await page.getByRole('button', { name: 'Дата', exact: true }).click();
    const counts = page.locator('.vt-pop .vt-opt .vt-opt-n');
    // Числа появляются, когда подборка дочитана, — у всех периодов сразу и больше не меняются.
    await expect(counts).toHaveCount(4);
    const numbers = (await counts.allInnerTexts()).map((text) => Number.parseInt(text, 10));
    const index = numbers.findIndex((value) => value > 0);
    expect(index).toBeGreaterThanOrEqual(0);
    const expected = numbers[index]!;
    await page
      .locator('.vt-pop .vt-opt')
      .nth(index + 1)
      .getByRole('radio')
      .check();
    const show = page.locator('.vt-pop-foot .btn.is-primary');
    await expect(show).toHaveText(new RegExp(`^Показать ${expected} `));
    await show.click();
    await expect(page.locator('.vl-count .num')).toHaveText(String(expected));
  });

  test('B645: роли «Карьеры» — фильтр по умолчанию; чип убирается, «Сбросить всё» очищает', async ({
    page,
  }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    await openCabinet(page, '/app/vacancies', {
      campaignRoles: ['Руководитель разработки', 'Директор по разработке'],
    });
    await expect(page.getByRole('button', { name: /^Роли: выбрано 2/ })).toBeVisible();
    const chips = page.locator('.vt-chips .vt-chip');
    await expect(chips).toHaveCount(2);
    await page.getByRole('button', { name: 'Убрать: Директор по разработке' }).click();
    await expect(chips).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Роли: выбрано 1/ })).toBeVisible();
    await page.locator('.vt-chips').getByRole('button', { name: 'Сбросить всё' }).click();
    await expect(chips).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Все роли/ })).toBeVisible();
  });

  test('B726: чип роли из «Вакансий по роли» — русское название роли поиска', async ({ page }) => {
    await openCabinet(page, '/app/vacancies?role=CTO&date=30', {
      campaignRoles: ['CTO', 'Руководитель продукта'],
      titlesRu: { CTO: 'Технический директор (CTO)' },
    });
    const chips = page.locator('.vt-chips .vt-chip');
    await expect(chips.first()).toHaveText('Технический директор (CTO)');
    await expect(
      page.getByRole('button', { name: 'Убрать: Технический директор (CTO)' }),
    ).toBeVisible();
  });

  test('B768: «Вакансии по роли» читают подборку сразу с ролью, снятая роль — вся подборка', async ({
    page,
  }) => {
    const rows: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        url.pathname.endsWith('/candidate/matched-vacancies') &&
        url.searchParams.get('part') === 'rows'
      )
        rows.push(url.searchParams.getAll('role').join('|'));
    });
    await openCabinet(page, '/app/vacancies?role=CTO&date=30', {
      campaignRoles: ['CTO', 'Руководитель продукта'],
      titlesRu: { CTO: 'Технический директор (CTO)' },
    });
    await expect(page.locator('.vt-chips .vt-chip').first()).toHaveText(
      'Технический директор (CTO)',
    );
    await expect.poll(() => rows.length).toBeGreaterThan(0);
    expect(rows.every((roles) => roles !== '')).toBe(true);
    await page.getByRole('button', { name: 'Убрать: Технический директор (CTO)' }).click();
    await expect.poll(() => rows.includes('')).toBe(true);
  });

  test('B645: строка «Проверить N навыка» ведёт в проверку навыков', async ({ page }) => {
    await openCabinet(page, '/app/vacancies', {
      campaignRoles: ['Руководитель разработки'],
      skillGap: 3,
    });
    const link = page.locator('.vt-skill a.row-act');
    await expect(link).toHaveText('Проверить 3 навыка');
    await expect(link).toHaveAttribute('href', /\/app\/career\/skills/u);
  });

  test('B645: «Помочь выбрать» — ссылка на режим подборки', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    await expect(page.locator('a.btn.va-review')).toHaveAttribute(
      'href',
      '/app/vacancies?mode=review',
    );
  });

  test('B726: роль из адреса («Вакансии по роли» из «Карьеры») — в фильтре и в запросе', async ({
    page,
  }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    const asked: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/candidate/matched-vacancies')) {
        asked.push(...url.searchParams.getAll('role'));
      }
    });
    await openCabinet(page, '/app/vacancies?role=Руководитель+продукта');
    await expect(page.getByRole('button', { name: /^Роли: выбрано 1/ })).toBeVisible();
    await expect.poll(() => asked).toContain('Руководитель продукта');
    await page.getByRole('button', { name: /^Роли: выбрано 1/ }).click();
    await expect(
      page.locator('.vt-pop .vt-opt', { hasText: 'Руководитель продукта' }).getByRole('checkbox'),
    ).toBeChecked();
  });

  test('B726: «Вакансии по роли» — роль и «Дата: 30 дней» из адреса, строк столько же, сколько в счёте', async ({
    page,
  }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    await openCabinet(page, '/app/vacancies?role=Руководитель+продукта&date=30');
    await expect(page.getByRole('button', { name: /^Роли: выбрано 1/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Дата · 30 дней/ })).toBeVisible();
    await expect(page.locator('.vt-chips')).toContainText('Дата: 30 дней');
    const count = page.locator('.vl-count .num');
    await expect(count).toBeVisible();
    await expect(page.locator(ROWS)).toHaveCount(Number(await count.innerText()));
  });

  test('B726: «Дата» не из фильтра в адресе не ставится', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo.project.name), 'на 390 фильтры — нижний лист');
    await openCabinet(page, '/app/vacancies?role=Руководитель+продукта&date=45');
    await expect(page.getByRole('button', { name: /^Роли: выбрано 1/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Дата$/ })).toBeVisible();
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
    expect(calls[0]?.query).toBe('');
    expect(calls[0]?.clusterIds).toBeUndefined();
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

  test('«Помочь выбрать»: нажатие до конца дочитывания — один запрос, сервер разбирает всю подборку', async ({
    page,
  }) => {
    await openCabinet(page, '/app/vacancies', { total: 450 });
    // Следующие порции подборки приходят с задержкой: разбор их не ждёт.
    await page.route('**/api/v1/candidate/matched-vacancies?**', async (route) => {
      const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? '0');
      if (offset > 0) await new Promise((resolve) => setTimeout(resolve, 1_500));
      return route.fallback();
    });
    const calls = await mockTriage(page, 450);
    const skips: string[] = [];
    await page.route('**/api/v1/candidate/vacancy-skips**', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      skips.push((route.request().postDataJSON() as { clusterId: string }).clusterId);
      return route.fulfill({ json: { data: {} } });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(ROWS).first()).toBeVisible();
    await page.locator('.va-review').click();
    await expect(page.locator(PICKED)).toHaveCount(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe('');
    expect(calls[0]?.clusterIds).toBeUndefined();
    await expect(page.locator('.vl-foot .btn')).toContainText('осталось 430');
    expect(calls).toHaveLength(1);
    await page.locator('.vz-q1-a').getByRole('button', { name: 'Да' }).click();
    await expect(page.locator(PRIMARY)).toContainText('4');
    expect(calls).toHaveLength(2);
    await page.locator(PRIMARY).click();
    await expect(page.locator('.va-snack')).toContainText('Скрыто');
    expect(skips).toHaveLength(4);
  });

  test('«Помочь выбрать»: скрывать нечего — строка итога, режим закрыт, кнопки с нулём нет', async ({
    page,
  }) => {
    await openCabinet(page, '/app/vacancies');
    let calls = 0;
    await page.route('**/api/v1/candidate/b640/vacancy-triage', async (route) => {
      calls += 1;
      const ids = await poolIds(page, 45);
      return route.fulfill({
        json: {
          data: {
            rows: ids.map((clusterId) => ({ clusterId, verdict: 'keep' })),
            questions: [],
            questionTotal: 0,
            summary: { total: ids.length, keep: ids.length, hide: 0, needsData: 0 },
          },
          meta: { requestId: 'triage-empty' },
        },
      });
    });
    await page.locator('.va-review').click();
    await expect(page.locator('p.vz-st')).toHaveText('Скрывать нечего: все 45 вакансий подходят');
    await expect(page.locator('.vz-bar')).toHaveCount(0);
    await expect(page.locator('.va-review')).not.toHaveAttribute('aria-current', 'true');
    await expect(page.locator(ROWS)).toHaveCount(20);
    expect(calls).toBe(1);
    await expectGates(page);
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

const OWN = {
  id: 'own-00000000-0000-4000-8000-000000000001',
  title: 'Руководитель группы бэкенда',
  company: 'Ритм Ритейл',
  location: 'Москва',
  workFormat: 'office',
  url: null,
  createdAt: '2026-11-18T10:00:00.000Z',
  coverage: { matched: 3, total: 5 },
  comparing: false,
};

async function openOwnPanel(page: Page): Promise<void> {
  await page.locator('.va-addbtn').click();
  await expect(page.locator('#va-add')).toBeVisible();
  await expect(page.locator('#va-add-in')).toBeFocused();
}

test.describe('B676: своя вакансия', () => {
  test('вставленный текст — строка «ваша» первой, «3 из 5» без процента', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    const bodies: unknown[] = [];
    await page.route('**/api/v1/candidate/b640/own-vacancies', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: { data: { outcome: 'created', vacancy: OWN }, meta: { requestId: 'c' } },
      });
    });
    await openOwnPanel(page);
    await page
      .locator('#va-add-in')
      .fill('Руководитель группы бэкенда\n\nТребования:\n- Go\n- Kafka');
    await page.locator('#va-add .va-add-foot .btn').click();
    await expect(page.locator('#va-add')).toHaveCount(0);
    const first = page.locator(ROWS).first();
    await expect(first.locator('.va-mine')).toContainText('ваша');
    await expect(first.locator('.vt-fitc')).toContainText('3 из 5');
    await expect(first.locator('.vt-fitc')).not.toContainText('%');
    expect(bodies).toEqual([{ text: 'Руководитель группы бэкенда\n\nТребования:\n- Go\n- Kafka' }]);
    await expectGates(page);
  });

  test('страница не открылась — ошибка у поля, «Повторить» и «Вставить текст»', async ({
    page,
  }) => {
    await openCabinet(page, '/app/vacancies');
    let posts = 0;
    await page.route('**/api/v1/candidate/b640/own-vacancies', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts += 1;
      return route.fulfill({
        json: { data: { outcome: 'unreadable', reason: 'failed' }, meta: { requestId: 'u' } },
      });
    });
    await openOwnPanel(page);
    await page.locator('#va-add-in').fill('https://jobs.example.com/a/1');
    await page.locator('#va-add .va-add-foot .btn').click();
    const status = page.locator('#va-add-st');
    await expect(status).toContainText('Страница не открылась');
    await expect(page.locator('#va-add-in')).toHaveAttribute('aria-invalid', 'true');
    await status.getByRole('button', { name: 'Повторить' }).click();
    await expect.poll(() => posts).toBe(2);
    await status.getByRole('button', { name: 'Вставить текст' }).click();
    await expect(page.locator('#va-add-in')).toHaveValue('');
    await expect(page.locator('#va-add-in')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#va-add')).toHaveCount(0);
  });

  test('ссылка на вакансию из подборки открывает её карточку', async ({ page }) => {
    await openCabinet(page, '/app/vacancies');
    await page.route('**/api/v1/candidate/b640/own-vacancies', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            json: {
              data: { outcome: 'in_pool', clusterId: 'cluster-hh-1' },
              meta: { requestId: 'p' },
            },
          })
        : route.fallback(),
    );
    await openOwnPanel(page);
    await page.locator('#va-add-in').fill('https://hh.ru/vacancy/12345678');
    await page.locator('#va-add .va-add-foot .btn').click();
    await expect(page).toHaveURL(/\/app\/vacancies\/cluster-hh-1$/u);
  });

  test('снимки панели и строки «ваша» для сверки с макетом', async ({ page }, testInfo) => {
    test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
    mkdirSync('.s13-shots', { recursive: true });
    const width = isMobile(testInfo.project.name) ? 390 : 1440;
    await openCabinet(page, '/app/vacancies', { own: [OWN] });
    await expect(page.locator(ROWS).first().locator('.va-mine')).toBeVisible();
    await page.screenshot({ path: `.s13-shots/own-row-${width}.png` });
    await openOwnPanel(page);
    await page.screenshot({ path: `.s13-shots/own-panel-${width}.png` });
  });
});
