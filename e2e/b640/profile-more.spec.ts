import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const API = '**/api/v1/candidate';

function change(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `ch-${index}`,
    actor: 'candidate',
    section: 'experience',
    kind: 'value',
    itemId: 'exp-1',
    label: `«FinCloud» · правка ${index}`,
    previousText: index % 2 ? '8 человек' : '',
    appliedText: '9 человек',
    createdAt: new Date(Date.UTC(2026, 10, 12 - Math.floor(index / 3), 9, 0)).toISOString(),
    revertedAt: null,
    ...overrides,
  };
}

function contact(
  index: number,
  fullName: string,
  companyName: string,
  roleTitle: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `contact:c-${index}`,
    fullName,
    companyName,
    roleTitle,
    inSelection: false,
    vacancyId: null,
    circle: 1,
    via: null,
    message: { kind: 'known_contact', target: { contactId: `c-${index}` } },
    ...extra,
  };
}

const IN_POOL = { inSelection: true, vacancyId: 'v-1' };
const CONTACTS = [
  contact(1, 'Роман Ефимов', 'Ладога Банк', 'руководитель группы платежей', IN_POOL),
  contact(2, 'Наталья Седова', 'Ладога Банк', 'директор по разработке', {
    ...IN_POOL,
    circle: 2,
    via: 'Роман Ефимов',
    message: { kind: 'ask_introduction', target: { contactId: 'c-1', vacancyId: 'v-1' } },
  }),
  contact(3, 'Анна Ким', 'Северный Банк', 'руководитель подбора'),
  ...Array.from({ length: 1361 }, (_, index) =>
    contact(
      10 + index,
      `Знакомый ${index + 1}`,
      `Компания ${Math.floor(index / 3) + 1}`,
      'инженер',
    ),
  ),
];

interface Mocks {
  readonly historyTotal?: number;
  readonly noContacts?: boolean;
  /** Сколько первых отмен правки отдать конфликтом. */
  readonly revertConflicts?: number;
}

interface Calls {
  readonly reverted: string[];
  readonly resumePuts: Array<{ experience: Array<Record<string, unknown>> }>;
  readonly imports: Array<Record<string, unknown>>;
  readonly drafts: Array<Record<string, unknown>>;
}

async function openCabinet(page: Page, path: string, mocks: Mocks = {}): Promise<Calls> {
  const calls: Calls = { reverted: [], resumePuts: [], imports: [], drafts: [] };
  const total = mocks.historyTotal ?? 23;
  let conflicts = mocks.revertConflicts ?? 0;
  const reverted = new Set<string>();
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route(`${API}/profile/history**`, (route) => {
    const url = new URL(route.request().url());
    const revert = url.pathname.match(/history\/([^/]+)\/revert$/u);
    if (revert) {
      if (conflicts > 0) {
        conflicts -= 1;
        return route.fulfill({
          status: 409,
          json: {
            error: { code: 'profile_change_conflict', message: 'С тех пор это место изменилось.' },
          },
        });
      }
      calls.reverted.push(revert[1]);
      reverted.add(revert[1]);
      return route.fulfill({ json: { data: { reverted: true } } });
    }
    const pageNumber = Number(url.searchParams.get('page') ?? 0);
    const source = url.searchParams.get('source');
    const entries = Array.from({ length: total }, (_, index) =>
      change(
        index,
        index === 2
          ? { actor: 'consultant' }
          : index === 1
            ? {
                section: 'status',
                label: 'Статус',
                previousText: 'Присматриваюсь',
                appliedText: 'Ищу работу',
              }
            : {},
      ),
    ).filter((entry) => !source || entry.actor === source);
    const shown = entries
      .map((entry) =>
        reverted.has(entry.id) ? { ...entry, revertedAt: '2026-11-17T09:00:00.000Z' } : entry,
      )
      .slice(pageNumber * 20, pageNumber * 20 + 20);
    return route.fulfill({
      json: {
        data: {
          entries: shown,
          total: entries.length,
          page: pageNumber,
          pageSize: 20,
          sources: { all: total, candidate: Math.max(0, total - 1), consultant: total ? 1 : 0 },
        },
      },
    });
  });
  await page.route(`${API}/b640/connections**`, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const needle = (params.get('search') ?? '').toLowerCase();
    const all = mocks.noContacts ? [] : CONTACTS;
    const found = all.filter(
      (item) =>
        (params.get('pool') !== 'true' || item.inSelection) &&
        `${item.fullName} ${item.companyName}`.toLowerCase().includes(needle),
    );
    const offset = Number(params.get('offset') ?? 0);
    const items = found.slice(offset, offset + 20);
    const shown = offset + items.length;
    return route.fulfill({
      json: {
        data: {
          items,
          total: found.length,
          connections: all.length,
          selectionCompanies: mocks.noContacts ? 0 : 1,
          selectionPending: false,
          offset,
          nextOffset: shown < found.length ? shown : null,
          linkedinImport: mocks.noContacts
            ? { state: 'unknown', importedAt: null, importedCount: null }
            : {
                state: 'imported',
                importedAt: '2026-11-10T09:00:00.000Z',
                importedCount: all.length,
              },
        },
      },
    });
  });
  await page.route(`${API}/b640/contact-messages`, (route) => {
    calls.drafts.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: {
        data: {
          id: 'm-1',
          kind: 'known_contact',
          text: 'Черновик сообщения',
          recipient: { name: 'Роман Ефимов', linkedinUrl: null },
          createdAt: '2026-11-12T09:00:00.000Z',
        },
      },
    });
  });
  await page.route(`${API}/resume`, (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const draft = route.request().postDataJSON();
    calls.resumePuts.push(draft);
    return route.fulfill({
      json: {
        data: {
          draft,
          savedAt: null,
          projection: {},
          evidenceFreshness: { valid: true, stale: [] },
        },
      },
    });
  });
  await page.route(`${API}/resume/import`, (route) => {
    calls.imports.push(route.request().postDataJSON());
    return route.fulfill({
      status: 422,
      json: { error: { code: 'resume_unreadable', message: 'В файле не нашли опыта работы.' } },
    });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
  return calls;
}

const node = (page: Page, code: string) => page.locator(`[data-b640-node="${code}"]`);

test.describe('B651: «История изменений» (p10)', () => {
  test('правки по дням, «Отменить» на месте, догрузка по 20; гейты', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/history');
    const screen = node(page, 'p10');
    await expect(screen.locator('#hx-title')).toHaveText('23 правки профиля');
    await expect(screen.locator('.hx-row')).toHaveCount(20);
    await expect(screen.locator('.hx-d').first()).toHaveText('12 ноября');
    await expectGates(page);

    const first = screen.locator('.hx-row').first();
    await first.getByRole('button', { name: /Отменить: «FinCloud» · правка 0/u }).click();
    await expect(first.locator('.hx-res .res-t')).toHaveText('Отменено');
    await expect(first.getByRole('button', { name: /Вернуть/u })).toBeVisible();
    await expect(first.getByRole('button', { name: /Отменить/u })).toHaveCount(0);
    expect(calls.reverted).toEqual(['ch-0']);

    // Смену статуса отсюда не отменяют.
    await expect(
      screen
        .locator('.hx-row')
        .nth(1)
        .getByRole('button', { name: /Отменить/u }),
    ).toHaveCount(0);

    await screen.getByRole('button', { name: 'Показать ещё 3' }).click();
    await expect(screen.locator('.hx-row')).toHaveCount(23);
    await expect(screen.getByRole('button', { name: /Показать ещё/u })).toHaveCount(0);
  });

  test('чипы источника: счёт с сервера и отбор', async ({ page }) => {
    await openCabinet(page, '/app/profile/history');
    const chips = node(page, 'p10').getByRole('group', { name: 'Источник правки' });
    await expect(chips.getByRole('button')).toHaveText([
      'Все · 23',
      'С ваших слов · 22',
      'Консультант · 1',
    ]);
    await chips.getByRole('button', { name: 'Консультант · 1' }).click();
    await expect(node(page, 'p10').locator('.hx-row')).toHaveCount(1);
    await expect(node(page, 'p10').locator('#hx-title')).toHaveText('23 правки профиля');
    await chips.getByRole('button', { name: 'Все · 23' }).click();
    await expect(node(page, 'p10').locator('.hx-row')).toHaveCount(20);
  });

  test('отмена не прошла: причина в строке правки, кнопка остаётся', async ({ page }) => {
    await openCabinet(page, '/app/profile/history', { revertConflicts: 1 });
    const row = node(page, 'p10').locator('.hx-row').first();
    await row.getByRole('button', { name: /Отменить/u }).click();
    await expect(row.getByRole('alert')).toContainText('С тех пор это место изменилось.');
    await expect(row.getByRole('button', { name: /Отменить/u })).toBeVisible();
  });

  test('правок нет: один заголовок', async ({ page }) => {
    await openCabinet(page, '/app/profile/history', { historyTotal: 0 });
    await expect(node(page, 'p10').locator('#hx-title')).toHaveText('Правок пока нет');
    await expect(node(page, 'p10').locator('.hx-row')).toHaveCount(0);
  });
});

test.describe('B651: «Уточнение профиля» (p09)', () => {
  test('ответ записывается в профиль и показан на месте; гейты', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/question');
    const screen = node(page, 'p09');
    const field = screen.getByLabel('Сколько человек было в команде в «FinCloud»?');
    await expect(field).toBeVisible();
    await expectGates(page);

    await field.fill('много');
    await page.getByRole('button', { name: 'Ответить' }).click();
    await expect(screen.getByText('Только число')).toBeVisible();
    expect(calls.resumePuts).toHaveLength(0);

    await field.fill('9');
    await page.getByRole('button', { name: 'Ответить' }).click();
    await expect(screen.locator('.pf-done')).toContainText(
      'Записано: команда в «FinCloud» — 9 человек',
    );
    const saved = calls.resumePuts[0].experience.find((entry) => entry.id === 'exp-1');
    expect(saved).toMatchObject({ teamSize: 9, employer: 'FinCloud' });
  });

  test('«Не сейчас» возвращает в профиль', async ({ page }) => {
    await openCabinet(page, '/app/profile/question');
    await page.getByRole('link', { name: 'Не сейчас' }).click();
    await expect(page).toHaveURL(/\/app\/profile$/u);
  });
});

test.describe('B651: «Откуда взять опыт» (p04)', () => {
  test('источники ведут в свои разделы, одна залитая кнопка; гейты', async ({ page }) => {
    await openCabinet(page, '/app/profile/sources');
    const screen = node(page, 'p04');
    await expect(screen.locator('.src')).toHaveCount(4);
    await expect(page.locator('.b640 .is-primary:visible')).toHaveCount(1);
    await expectGates(page);
    await screen
      .locator('.src', { hasText: 'hh.ru' })
      .getByRole('link', { name: 'Подключить' })
      .click();
    await expect(page).toHaveURL(/\/app\/profile\/hh$/u);
  });

  test('файл не PDF: причина на месте, в профиль ничего не ушло', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/sources');
    const screen = node(page, 'p04');
    await screen.locator('input[type="file"]').setInputFiles({
      name: 'resume.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('не резюме'),
    });
    await expect(screen.getByRole('alert')).toContainText('Выберите PDF-файл.');
    expect(calls.imports).toHaveLength(0);
    await expect(screen.getByRole('button', { name: 'Выбрать файл' })).toBeEnabled();
  });
});

test.describe('B651: «Откуда взять опыт» (p04): замена профиля', () => {
  const pdf = {
    name: 'resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 broken'),
  };

  test('в профиле уже есть опыт: замену нужно подтвердить; «Отмена» ничего не меняет', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/profile/sources');
    const screen = node(page, 'p04');
    await screen.locator('input[type="file"]').setInputFiles(pdf);
    const dialog = page.getByRole('dialog', { name: 'Заменить профиль данными из файла?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Отмена' }).click();
    await expect(dialog).toHaveCount(0);
    expect(calls.imports).toHaveLength(0);
    await expect(screen.getByRole('button', { name: 'Выбрать файл' })).toBeEnabled();
  });

  test('файл не читается: понятная причина без технического текста', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/sources');
    const screen = node(page, 'p04');
    await screen.locator('input[type="file"]').setInputFiles(pdf);
    await page.getByRole('dialog').getByRole('button', { name: 'Заменить' }).click();
    const alert = screen.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/[A-Za-z]{4,}/u);
    expect(calls.imports).toHaveLength(0);
  });
});

test.describe('B651: «Связи» (p11)', () => {
  test('1364 связи: счёт компаний, порции по 20, подборка, поиск; гейты', async ({
    page,
  }, testInfo) => {
    await openCabinet(page, '/app/profile/connections');
    const screen = node(page, 'p11');
    const desktop = testInfo.project.name === 'desktop-1440';
    await expect(screen.locator(desktop ? '.ln-h-d' : '.ln-h-m')).toHaveText(
      desktop ? 'Знакомые есть в 1 компании из подборки' : 'Знакомые в 1 компании',
    );
    await expect(screen.locator('.ln-row')).toHaveCount(20);
    const first = screen.locator('.ln-co').first();
    await expect(first.locator('.ln-co-t')).toHaveText('Ладога Банк · в подборке');
    await expect(first.locator('.ln-row')).toHaveCount(2);
    await expect(first.locator('a.ln-open').first()).toHaveAttribute(
      'href',
      '/app/responses/v-1/letter',
    );
    await expectGates(page);
    if (desktop) {
      await page.setViewportSize({ width: 1176, height: 800 });
      await expectGates(page);
    }

    await screen.getByRole('button', { name: 'Показать ещё 20 · осталось 1344' }).click();
    await expect(screen.locator('.ln-row')).toHaveCount(40);

    if (desktop) await screen.getByLabel('Только компании из подборки').check();
    else await screen.getByRole('button', { name: 'Из подборки' }).click();
    await expect(screen.locator('.ln-row')).toHaveCount(2);
    if (desktop) await screen.getByLabel('Только компании из подборки').uncheck();
    else await screen.getByRole('button', { name: 'Из подборки' }).click();

    await screen.getByLabel('Поиск по связям').fill('северный');
    await expect(screen.locator('.ln-row')).toHaveCount(1);
    await expect(screen.locator('.ln-row .row-title')).toContainText('Анна Ким');
    await screen.getByLabel('Поиск по связям').fill('никого');
    await expect(screen.getByText('Никого не нашли')).toBeVisible();
  });

  test('«Написать» и «Попросить представить» открывают черновик, ничего не отправляя', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/profile/connections');
    const screen = node(page, 'p11');
    await screen.getByRole('button', { name: 'Написать: Роман Ефимов' }).click();
    await expect(screen.getByRole('textbox', { name: 'Черновик' })).toHaveValue(
      'Черновик сообщения',
    );
    await expect(screen.locator('.is-primary:visible')).toHaveCount(1);
    // Панель черновика общая с «Контактами»; здесь проверяем, что она не распирает экран.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await screen.getByRole('button', { name: 'Не отправлять' }).click();
    await expect(screen.getByRole('textbox', { name: 'Черновик' })).toHaveCount(0);
    await screen.getByRole('button', { name: 'Попросить представить: Наталья Седова' }).click();
    await expect(screen.getByRole('textbox', { name: 'Черновик' })).toBeVisible();
    expect(calls.drafts).toEqual([
      { contactId: 'c-1', kind: 'known_contact' },
      { contactId: 'c-1', vacancyId: 'v-1', kind: 'ask_introduction' },
    ]);
  });

  test('связей нет: заголовок и путь к подключению LinkedIn', async ({ page }) => {
    await openCabinet(page, '/app/profile/connections', { noContacts: true });
    const screen = node(page, 'p11');
    await expect(screen.getByRole('heading', { name: 'Связей пока нет' })).toBeVisible();
    await screen.getByRole('link', { name: 'Подключить LinkedIn' }).click();
    await expect(page).toHaveURL(/\/app\/profile\/linkedin$/u);
  });
});

test.describe('B651: «Добавить навык» (s01)', () => {
  test('навык записывается в профиль; гейты', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile');
    const add = node(page, 's01').locator('.skill-add');
    await add.locator('summary').click();
    await add.getByLabel('Навык').fill('Terraform');
    await expectGates(page);
    await add.getByLabel('Навык').press('Enter');
    await expect.poll(() => calls.resumePuts.length).toBe(1);
    const { skills } = calls.resumePuts[0] as unknown as { skills: Array<{ name: string }> };
    expect(skills.at(-1)?.name).toBe('Terraform');
    await expect(add).not.toHaveAttribute('open', '');
  });
});

test.describe('B651: снимки второй части для сверки с макетами', () => {
  const SCREENS: readonly (readonly [string, string])[] = [
    ['profile-history', '/app/profile/history'],
    ['profile-question', '/app/profile/question'],
    ['profile-sources', '/app/profile/sources'],
    ['profile-connections', '/app/profile/connections'],
  ];

  for (const [name, path] of SCREENS) {
    test(`снимки: ${name}`, async ({ page }, testInfo) => {
      test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
      mkdirSync('.s13-shots', { recursive: true });
      const desktop = testInfo.project.name === 'desktop-1440';
      const widths = desktop ? [1440, 1176] : [390];
      await openCabinet(page, path);
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => window.localStorage.setItem('oq_b640_theme', value), theme);
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.b640 .ls-skel')).toHaveCount(0);
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
