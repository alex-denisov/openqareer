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

function contact(index: number, fullName: string, companyName: string, roleTitle: string) {
  return {
    id: `c-${index}`,
    fullName,
    companyName,
    roleTitle,
    relationship: '',
    strength: 'unknown',
    linkedinUrl: null,
    workplaces: [],
    knowsRecruiterIds: [],
    source: 'linkedin_import',
    createdAt: '2026-11-10T09:00:00.000Z',
    updatedAt: '2026-11-10T09:00:00.000Z',
  };
}

const CONTACTS = [
  contact(1, 'Роман Ефимов', 'Ладога Банк', 'руководитель группы платежей'),
  contact(2, 'Наталья Седова', 'Ладога Банк', 'директор по разработке'),
  contact(3, 'Анна Ким', 'Северный Банк', 'руководитель подбора'),
  ...Array.from({ length: 30 }, (_, index) =>
    contact(10 + index, `Знакомый ${index + 1}`, `Компания ${index + 1}`, 'инженер'),
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
}

async function openCabinet(page: Page, path: string, mocks: Mocks = {}): Promise<Calls> {
  const calls: Calls = { reverted: [], resumePuts: [], imports: [] };
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
    const entries = Array.from({ length: total }, (_, index) =>
      change(
        index,
        index === 1
          ? {
              section: 'status',
              label: 'Статус',
              previousText: 'Присматриваюсь',
              appliedText: 'Ищу работу',
            }
          : {},
      ),
    )
      .map((entry) =>
        reverted.has(entry.id) ? { ...entry, revertedAt: '2026-11-17T09:00:00.000Z' } : entry,
      )
      .slice(pageNumber * 20, pageNumber * 20 + 20);
    return route.fulfill({ json: { data: { entries, total, page: pageNumber, pageSize: 20 } } });
  });
  await page.route(`${API}/connection-contacts**`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const items = mocks.noContacts ? [] : CONTACTS;
    return route.fulfill({
      json: {
        data: {
          items,
          total: items.length,
          offset: 0,
          limit: 100,
          nextOffset: null,
          linkedinImport: mocks.noContacts
            ? { state: 'unknown', importedAt: null, importedCount: null }
            : {
                state: 'imported',
                importedAt: '2026-11-10T09:00:00.000Z',
                importedCount: items.length,
              },
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
  test('связи по компаниям, поиск и «Показать ещё 20»; гейты', async ({ page }) => {
    await openCabinet(page, '/app/profile/connections');
    const screen = node(page, 'p11');
    await expect(screen.locator('#ln-title')).toHaveText('33 связи');
    await expect(screen.locator('.ln-row')).toHaveCount(20);
    await expect(screen.locator('.ln-co').first().locator('.ln-co-t')).toHaveText('Ладога Банк');
    await expect(screen.locator('.ln-co').first().locator('.ln-row')).toHaveCount(2);
    await expectGates(page);

    await screen.getByRole('button', { name: 'Показать ещё 13' }).click();
    await expect(screen.locator('.ln-row')).toHaveCount(33);

    await screen.getByLabel('Поиск по связям').fill('северный');
    await expect(screen.locator('.ln-row')).toHaveCount(1);
    await expect(screen.locator('.ln-row .row-title')).toHaveText('Анна Ким');
    await screen.getByLabel('Поиск по связям').fill('никого');
    await expect(screen.getByText('Никого не нашли')).toBeVisible();
  });

  test('связей нет: заголовок и путь к подключению LinkedIn', async ({ page }) => {
    await openCabinet(page, '/app/profile/connections', { noContacts: true });
    const screen = node(page, 'p11');
    await expect(screen.locator('#ln-title')).toHaveText('Связей пока нет');
    await screen.getByRole('link', { name: 'Подключить LinkedIn' }).click();
    await expect(page).toHaveURL(/\/app\/profile\/linkedin$/u);
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
