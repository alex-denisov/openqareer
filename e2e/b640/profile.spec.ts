import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const API = '**/api/v1/candidate';

const STATUSES = [
  ['looking', 'Присматриваюсь'],
  ['job_search', 'Ищу работу'],
  ['choosing_role', 'Ищу, кем работать'],
  ['changing_profession', 'Меняю профессию'],
  ['working', 'Работаю'],
] as const;

function statusState(current = 'job_search') {
  const label = STATUSES.find(([id]) => id === current)?.[1] ?? '';
  return {
    current: {
      status: current,
      label,
      title: label,
      targetProfession: null,
      since: null,
      chosen: true,
    },
    statuses: STATUSES.map(([id, name]) => ({ id, label: name, caption: '' })),
    history: [],
    revert: null,
  };
}

function preview(body: { status: string; targetProfession?: string }) {
  const label = STATUSES.find(([id]) => id === body.status)?.[1] ?? '';
  const unchanged = body.status === 'job_search';
  return {
    from: 'job_search',
    to: body.status,
    title: body.targetProfession ? `${label}: ${body.targetProfession}` : label,
    unchanged,
    appears: unchanged ? [] : ['План 30-60-90 и цели — на «Сегодня»', 'Рост в роли в «Карьере»'],
    leaves: [],
    stays: [],
    options:
      body.status === 'working'
        ? [{ key: 'pauseAutoApply', label: 'Поставить автоотклики на паузу', checked: true }]
        : [],
  };
}

interface Mocks {
  /** Сколько первых сохранений статуса отдать ошибкой. */
  readonly statusSaveFailures?: number;
  /** Профиль не загрузился с первого раза. */
  readonly resumeFailures?: number;
  /** Правая колонка s01: условия, связи и резюме под вакансии. */
  readonly aside?: boolean;
}

const VERSIONS = [
  ['v-1', 'Head of Engineering', 'draft', '2026-11-10T09:00:00.000Z'],
  ['v-2', 'Engineering Manager', 'sent', '2026-11-08T09:00:00.000Z'],
  ['v-3', 'Руководитель платформы', 'sent', '2026-11-04T09:00:00.000Z'],
].map(([id, title, status, updatedAt]) => ({
  id,
  title,
  status,
  updatedAt,
  createdAt: updatedAt,
  requirements: [],
  revision: 1,
  sourceMasterRevision: 'm-1',
}));

async function mockAside(page: Page, full: boolean): Promise<void> {
  await page.route(`${API}/campaign`, (route) =>
    route.fulfill({
      json: {
        data: {
          roles: { value: full ? ['Руководитель разработки'] : [], origin: 'explicit' },
          regions: { value: [], origin: 'default' },
        },
      },
    }),
  );
  if (!full) return;
  await page.route(`${API}/decision-profile`, (route) =>
    route.fulfill({
      json: {
        data: {
          salaryFloor: 500_000,
          searchLocations: ['Москва'],
          workFormats: ['remote_home', 'home_market'],
        },
      },
    }),
  );
  await page.route(`${API}/connection-contacts?*`, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [],
          total: 512,
          offset: 0,
          limit: 100,
          nextOffset: null,
          linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
        },
      },
    }),
  );
  await page.route(`${API}/resume/versions?*`, (route) =>
    route.fulfill({
      json: {
        data: { items: VERSIONS, nextCursor: null, totalCount: 14, currentMasterRevision: 'm-1' },
      },
    }),
  );
}

interface Calls {
  readonly statusPuts: unknown[];
  readonly resumePuts: Array<{ experience: Array<Record<string, unknown>> }>;
  readonly confirmed: string[];
}

async function openCabinet(page: Page, path: string, mocks: Mocks = {}): Promise<Calls> {
  const calls: Calls = { statusPuts: [], resumePuts: [], confirmed: [] };
  let saveFailures = mocks.statusSaveFailures ?? 0;
  let resumeFailures = mocks.resumeFailures ?? 0;
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route(`${API}/status`, (route) => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: { data: statusState() } });
    if (saveFailures > 0) {
      saveFailures -= 1;
      return route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'Сбой.' } },
      });
    }
    const body = route.request().postDataJSON() as { status: string };
    calls.statusPuts.push(body);
    return route.fulfill({
      json: { data: { ...statusState(body.status), applied: { pauseAutoApply: false } } },
    });
  });
  await page.route(`${API}/status/preview`, (route) =>
    route.fulfill({ json: { data: { preview: preview(route.request().postDataJSON()) } } }),
  );
  await page.route(`${API}/resume`, (route) => {
    if (route.request().method() === 'PUT') {
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
    }
    if (resumeFailures > 0) {
      resumeFailures -= 1;
      return route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'Сбой.' } },
      });
    }
    return route.fallback();
  });
  await mockAside(page, mocks.aside ?? false);
  await page.route(`${API}/profile/experience/*/confirm`, (route) => {
    calls.confirmed.push(new URL(route.request().url()).pathname.split('/').at(-2) ?? '');
    return route.fulfill({ json: { data: { confirmed: true } } });
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
  return calls;
}

const node = (page: Page, code: string) => page.locator(`[data-b640-node="${code}"]`);

test.describe('B651: «Статус» (s02)', () => {
  test('выбор статуса, «Что изменится» и смена ведёт на «Сегодня»; гейты', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/status');
    const screen = node(page, 's02');
    await expect(screen.locator('.pick label')).toHaveCount(5);
    await expect(
      screen.locator('.pick label', { hasText: 'Ищу работу' }).locator('.tag'),
    ).toHaveText('сейчас');
    await expect(screen.getByRole('radio', { name: /Ищу работу/u })).toBeChecked();
    await expect(screen.getByRole('button', { name: 'Сменить статус' })).toHaveCount(0);

    await screen.getByRole('radio', { name: 'Работаю' }).check();
    await expect(screen.locator('#pv-title')).toHaveText('Работаю');
    await expect(screen.locator('.change.add li')).toHaveCount(2);
    await expect(
      screen.getByRole('checkbox', { name: 'Поставить автоотклики на паузу' }),
    ).toBeChecked();
    await expectGates(page);

    await screen.getByRole('checkbox', { name: 'Поставить автоотклики на паузу' }).uncheck();
    await page.getByRole('button', { name: 'Сменить статус' }).click();
    await expect(page).toHaveURL(/\/app\/today$/u);
    expect(calls.statusPuts).toEqual([{ status: 'working', options: { pauseAutoApply: false } }]);
  });

  test('предложение из адреса: статус и профессия подставлены, чужое значение отброшено', async ({
    page,
  }) => {
    await openCabinet(
      page,
      `/app/profile/status?status=changing_profession&profession=${encodeURIComponent('Управление продуктом')}`,
    );
    const screen = node(page, 's02');
    await expect(screen.getByRole('radio', { name: 'Меняю профессию' })).toBeChecked();
    await expect(screen.getByLabel('Новая профессия')).toHaveValue('Управление продуктом');
    await expect(screen.locator('#pv-title')).toHaveText('Меняю профессию: Управление продуктом');

    await page.goto('/app/profile/status?status=admin&profession=x', {
      waitUntil: 'domcontentloaded',
    });
    await expect(node(page, 's02').getByRole('radio', { name: /Ищу работу/u })).toBeChecked();
  });

  test('сбой сохранения: строка на месте, выбор сохранён, повтор проходит', async ({ page }) => {
    const calls = await openCabinet(page, '/app/profile/status', { statusSaveFailures: 1 });
    const screen = node(page, 's02');
    await screen.getByRole('radio', { name: 'Присматриваюсь' }).check();
    await page.getByRole('button', { name: 'Сменить статус' }).click();
    await expect(screen.getByRole('alert')).toContainText('Статус не сохранился');
    await expect(screen.getByRole('radio', { name: 'Присматриваюсь' })).toBeChecked();
    await page.getByRole('button', { name: 'Сменить статус' }).click();
    await expect(page).toHaveURL(/\/app\/today$/u);
    expect(calls.statusPuts).toHaveLength(1);
  });
});

test.describe('B651: «Профиль» (s01)', () => {
  test('шапка по фото, «Уточнить · N», пустые разделы с «Добавить» (B645); гейты', async ({
    page,
  }) => {
    await openCabinet(page, '/app/profile');
    const screen = node(page, 's01');
    // Без фото — круг 72 с инициалами, роль одной строкой.
    await expect(screen.locator('.phead-ini')).toHaveText('МС');
    // Круг по размеру фото макета: 72 на 1440, 56 на 390; на 1440 роль одной строкой.
    const mobile = (page.viewportSize()?.width ?? 0) < 768;
    const pic = await screen.locator('.phead-ini').boundingBox();
    expect(Math.round(pic?.width ?? 0)).toBe(mobile ? 56 : 72);
    if (!mobile) {
      const head = await screen.locator('.phead').boundingBox();
      expect(Math.round(head?.height ?? 0)).toBe(72);
      await expect(screen.locator('.phead-role')).toHaveCSS('white-space', 'nowrap');
    }
    await expect(screen.locator('#sec-exp .exp-check')).toContainText('Уточнить · 3 вопроса');
    await expect(screen.locator('#unk-title ~ .actions')).toContainText('Ответить на 3 вопроса');
    for (const id of ['sec-recs', 'sec-awards', 'sec-orgs']) {
      const section = screen.locator(`#${id}`);
      await section.locator('summary').click();
      await expect(section.getByText('Не указано')).toBeVisible();
      await expect(section.getByRole('link', { name: 'Добавить' })).toHaveAttribute(
        'href',
        '/app/profile/sources',
      );
    }
    await expect(screen.locator('.psec-addmore .row-act')).toHaveText(['Патенты', 'Волонтёрство']);
    await expectGates(page);
  });

  test('шапка, статус, опыт и разделы; переходы к статусу и правке; гейты', async ({ page }) => {
    await openCabinet(page, '/app/profile');
    const screen = node(page, 's01');
    await expect(screen.locator('.phead-name')).toHaveText('Мария Соколова');
    await expect(screen.locator('.status-now')).toHaveText('Ищу работу');
    await expect(screen.locator('#sec-exp .job').first().locator('.job-title')).toHaveText(
      'Руководитель продукта',
    );
    await expect(screen.locator('#sec-exp .job-org').first()).toContainText(
      'FinCloud · 2022 — сейчас',
    );
    await expect(page.locator('.b640 .is-primary:visible')).toHaveCount(
      (await screen.locator('#unk-title').count()) > 0 ? 1 : 0,
    );
    await expectGates(page);

    await screen.getByRole('link', { name: 'Изменить запись: FinCloud' }).click();
    await expect(page).toHaveURL(/\/app\/profile\/experience\/exp-1$/u);
    await page.goBack();
    await node(page, 's01').getByRole('link', { name: 'Сменить' }).click();
    await expect(page).toHaveURL(/\/app\/profile\/status$/u);
  });

  test('правая колонка: условия, связи, чего мы не знаем, резюме под роль (B645); гейты', async ({
    page,
  }) => {
    await openCabinet(page, '/app/profile', { aside: true });
    const screen = node(page, 's01');
    const desk = (page.viewportSize()?.width ?? 0) >= 768;
    const terms = desk ? screen.locator('.mod.terms') : screen.locator('details.terms-row');
    if (!desk) {
      await expect(terms.locator('.terms-sum')).toHaveText(
        'Руководитель разработки · от 500 000 ₽ на руки · Москва',
      );
      await terms.locator('summary').click();
    }
    await expect(terms.locator('dd')).toHaveText([
      'Руководитель разработки',
      'от 500 000 ₽ на руки',
      'Москва',
      'удалённо или гибрид',
    ]);
    await expect(screen.locator('#ln-t')).toHaveText('Связи · 512');
    await expect(screen.locator('#unk-title')).toHaveText('Чего мы не знаем');
    await expect(screen.getByRole('link', { name: 'Ответить на 3 вопроса' })).toBeVisible();
    await expect(screen.locator('.cv-base .cv-main b')).toHaveText('Руководитель разработки');
    await expect(screen.locator('.cv-sub')).toHaveText('Под вакансии · 14');
    await expect(screen.locator('.cv-row .tag')).toHaveText([
      'черновик',
      'отправлено',
      'отправлено',
    ]);
    await expect(screen.getByRole('link', { name: 'Ещё 11 — в «Откликах»' })).toBeVisible();
    await expectGates(page);

    await screen.getByRole('link', { name: 'Ответить на 3 вопроса' }).click();
    await expect(page).toHaveURL(/\/app\/profile\/question$/u);
  });

  test('профиль не загрузился: строка на месте и «Повторить»', async ({ page }) => {
    await openCabinet(page, '/app/profile', { resumeFailures: 1 });
    const screen = node(page, 's01');
    await expect(screen.getByRole('alert')).toContainText('Профиль не загрузился');
    await screen.getByRole('button', { name: 'Повторить' }).click();
    await expect(screen.locator('.phead-name')).toBeVisible();
  });
});

test.describe('B651: «Проверка записей» (p06)', () => {
  test('«Верно» подтверждает запись на месте, «Исправить» ведёт в правку; гейты', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/profile/review');
    const screen = node(page, 'p06');
    await expect(screen.locator('.pw').first().locator('.pw-ok')).toHaveText('Подтверждено');
    const card = screen.locator('.pw').nth(1);
    await expect(card.locator('.pg-t')).toHaveText('Старший продуктовый менеджер');
    await expectGates(page);
    await card.getByRole('button', { name: 'Верно: Ozon' }).click();
    await expect(card.locator('.pw-ok')).toHaveText('Подтверждено');
    await expect(card.getByRole('button', { name: /Верно/u })).toHaveCount(0);
    expect(calls.confirmed).toEqual(['exp-2']);
    await card.getByRole('link', { name: 'Исправить: Ozon' }).click();
    await expect(page).toHaveURL(/\/app\/profile\/experience\/exp-2$/u);
  });
});

test.describe('B651: «Правка места работы» (p07)', () => {
  test('ошибки полей на месте, сохранение пишет запись и даёт отменить; гейты', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/profile/experience/exp-2');
    const screen = node(page, 'p07');
    await expect(screen.getByLabel('Компания')).toHaveValue('Ozon');
    await expect(screen.getByLabel('Начало')).toHaveValue('Январь 2019');
    await expectGates(page);

    await screen.getByLabel('Компания').fill('');
    await screen.getByLabel('Город').fill('Мсква');
    await page.locator('.b640 button[type="submit"]:visible').click();
    await expect(screen.getByText('Укажите компанию')).toBeVisible();
    await expect(screen.getByText('Нет в справочнике — выберите из списка')).toBeVisible();
    expect(calls.resumePuts).toHaveLength(0);

    await screen.getByLabel('Компания').fill('Озон Технологии');
    await screen.getByLabel('Город').fill('Мос');
    await screen.getByRole('option', { name: 'Москва' }).click();
    await screen.getByLabel(/Команда, человек/u).fill('12');
    await page.locator('.b640 button[type="submit"]:visible').click();
    await expect(page).toHaveURL(/\/app\/profile$/u);
    await expect(page.locator('.b640').getByText('Сохранено')).toBeVisible();
    const saved = calls.resumePuts[0].experience.find((entry) => entry.id === 'exp-2');
    expect(saved).toMatchObject({ employer: 'Озон Технологии', location: 'Москва', teamSize: 12 });

    await page.getByRole('button', { name: 'Отменить' }).click();
    await expect.poll(() => calls.resumePuts.length).toBe(2);
    const restored = calls.resumePuts[1].experience.find((entry) => entry.id === 'exp-2');
    expect(restored).toMatchObject({ employer: 'Ozon' });
  });

  test('окончание раньше начала: ошибка периода; месяц выбирается в окне', async ({ page }) => {
    await openCabinet(page, '/app/profile/experience/exp-2');
    const screen = node(page, 'p07');
    await screen.getByLabel('Окончание').click();
    const dialog = page.getByRole('dialog', { name: 'Окончание' });
    await dialog.getByLabel('Год').fill('2017');
    await dialog.getByRole('button', { name: 'Готово' }).click();
    await page.locator('.b640 button[type="submit"]:visible').click();
    await expect(screen.getByText('Окончание раньше начала')).toBeVisible();
  });

  test('записи нет: одна строка и путь в профиль', async ({ page }) => {
    await openCabinet(page, '/app/profile/experience/no-such');
    const screen = node(page, 'p07');
    await expect(screen.getByText('Такой записи в профиле нет')).toBeVisible();
    await screen.getByRole('link', { name: 'Открыть профиль' }).click();
    await expect(page).toHaveURL(/\/app\/profile$/u);
  });
});

test.describe('B651: снимки для сверки с макетами', () => {
  const SCREENS: readonly (readonly [string, string])[] = [
    ['profile', '/app/profile'],
    ['profile-status', '/app/profile/status?status=working'],
    ['profile-review', '/app/profile/review'],
    ['profile-edit', '/app/profile/experience/exp-2'],
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
        await expect(page.locator('.b640 .ls-skel, .b640 .ls-state')).toHaveCount(0);
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
