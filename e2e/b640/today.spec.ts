import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates } from './gates';

const SHOTS = process.env.B640_SHOTS;
const API = '**/api/v1/candidate';

type StatusId = 'looking' | 'job_search' | 'choosing_role' | 'changing_profession' | 'working';

const TITLES: Record<StatusId, string> = {
  looking: 'Присматриваюсь',
  job_search: 'Ищу работу',
  choosing_role: 'Ищу, кем работать',
  changing_profession: 'Меняю профессию: продакт-менеджер',
  working: 'Работаю',
};

const MODULES: Record<StatusId, readonly (readonly [string, string])[]> = {
  looking: [
    ['weekly_vacancies', 'Вакансии за неделю'],
    ['applications_summary', 'Ваши отклики'],
  ],
  job_search: [
    ['next_action', 'Следующее действие'],
    ['applications_summary', 'Ваши отклики'],
    ['profile_question', 'Один вопрос о профиле'],
  ],
  choosing_role: [
    ['role_options', 'Какая роль вам ближе'],
    ['role_vacancies', 'Вакансии по этой роли'],
  ],
  changing_profession: [
    ['profession_fit', 'Требования новой профессии'],
    ['profession_reason', 'Почему вы меняете профессию?'],
    ['profile_question', 'Один вопрос о профиле'],
    ['applications_summary', 'Ваши отклики'],
  ],
  working: [
    ['onboarding_plan', 'План на первые 90 дней'],
    ['next_meeting', 'Ближайшая встреча'],
    ['record_result', 'В профиль: результат'],
  ],
};

const REVERT = {
  changeId: 'ch-1',
  previousStatus: 'job_search',
  previousTitle: 'Ищу работу',
  until: '2099-01-01T00:00:00.000Z',
};

function statusToday(status: StatusId, revert: typeof REVERT | null = null) {
  return {
    status,
    title: TITLES[status],
    chosen: true,
    modules: MODULES[status].map(([key, title]) => ({ key, title })),
    revert,
  };
}

const SKILL_DEMAND = {
  state: 'ready',
  roles: [
    {
      roleTitle: 'Продакт-менеджер',
      sampleSize: 118,
      observedAt: '2026-11-10T09:00:00.000Z',
      skills: [
        { name: 'Планирование релизов', vacancies: 40, inProfile: true },
        { name: 'Работа с заказчиком', vacancies: 36, inProfile: true },
        { name: 'Исследования пользователей', vacancies: 31, inProfile: false },
        { name: 'A/B-тесты', vacancies: 22, inProfile: false },
      ],
    },
  ],
};

interface Note {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
  readAt: string | null;
  action: { label: string; href: string };
}

function note(index: number, overrides: Partial<Note> = {}): Note {
  const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return {
    id,
    kind: 'employer_reply',
    title: 'Есть ответ работодателя',
    createdAt: new Date(Date.now() - index * 60_000).toISOString(),
    readAt: null,
    action: {
      label: 'Напомнить рекрутеру',
      href: `/app?view=responses&notificationSource=app-${index}`,
    },
    ...overrides,
  };
}

const OLD = '2026-11-02T09:00:00.000Z';

function firstPage(): Note[] {
  return [
    note(1),
    note(2, { kind: 'email_approval', title: 'Письмо ждёт одобрения' }),
    note(3, {
      kind: 'footprint_findings',
      title: 'Есть находки для проверки',
      createdAt: OLD,
      readAt: OLD,
    }),
    note(4, {
      kind: 'new_vacancies_by_role',
      title: 'Новые вакансии по вашей роли',
      createdAt: OLD,
      readAt: OLD,
    }),
  ];
}

/** Ответ `/candidate/today` в форме прода 16.11: пустые `dueAt` и `fit`, у поста — `draftId`. */
const PROD_DAY = {
  digest: {
    waitingForYou: 3,
    newVacancies: 0,
    followUpsDueToday: 0,
    followUpsOverdue: 1,
    closedVacancies: 0,
    interviewsAhead: 0,
    nextInterview: null,
    newVacanciesCaption: null,
    followUpCaptions: [],
  },
  queue: [
    {
      kind: 'follow_up',
      applicationId: 'app-prod-1',
      title: 'Director of Engineering, AI Functions',
      company: 'Snowflake',
      eyebrow: 'ответа нет 47 дней',
      dueAt: '2026-10-05T00:00:00.000Z',
      fit: null,
    },
    ...['о найме инженеров', 'про рост команды'].map((title, index) => ({
      kind: 'linkedin_post',
      draftId: `draft-${index + 1}`,
      title,
      company: 'LinkedIn',
      eyebrow: 'сам не опубликуется',
      dueAt: null,
      fit: null,
    })),
  ],
  followUps: [],
  sinceLastVisit: { since: null, items: [] },
  vacanciesPending: false,
  momentum: null,
  funnel: { favorites: 2, applied: 13, responses: 2, interviews: 1, offers: 1 },
  queueTotal: 3,
  queueRevision: 'rev-1',
  queueOffset: 0,
  connectedSources: ['linkedin'],
};

interface Mocks {
  /** День в форме прода вместо общей фикстуры. */
  readonly prodDay?: boolean;
  /** Сколько первых чтений дня оборвать, как при истёкшем ожидании. */
  readonly dayFailures?: number;
  readonly status?: StatusId;
  readonly revert?: boolean;
  /** Сколько первых чтений статуса отдать ошибкой. */
  readonly statusFailures?: number;
  readonly notes?: Note[];
  readonly hasMore?: boolean;
}

interface Calls {
  readonly read: string[];
  readAll: number;
  reverted: number;
}

async function openCabinet(page: Page, path: string, mocks: Mocks = {}): Promise<Calls> {
  const calls: Calls = { read: [], readAll: 0, reverted: 0 };
  let status = mocks.status ?? 'job_search';
  let revert = mocks.revert ? REVERT : null;
  let failures = mocks.statusFailures ?? 0;
  let notes = mocks.notes ?? firstPage();
  await mockSignedInCabinet(page, { cabinetB640: true });
  await page.route(`${API}/status/today`, (route) => {
    if (failures > 0) {
      failures -= 1;
      return route.fulfill({
        status: 500,
        json: { error: { code: 'internal', message: 'Сбой.' } },
      });
    }
    return route.fulfill({ json: { data: { today: statusToday(status, revert) } } });
  });
  let dayFailures = mocks.dayFailures ?? 0;
  await page.route(`${API}/today?**`, (route) => {
    if (dayFailures > 0) {
      dayFailures -= 1;
      return route.abort('timedout');
    }
    return mocks.prodDay ? route.fulfill({ json: { data: PROD_DAY } }) : route.fallback();
  });
  await page.route(`${API}/status/revert`, (route) => {
    calls.reverted += 1;
    status = 'job_search';
    revert = null;
    return route.fulfill({
      json: {
        data: {
          current: {
            status,
            label: TITLES[status],
            title: TITLES[status],
            targetProfession: null,
            since: null,
            chosen: true,
          },
          statuses: [],
          history: [],
          revert: null,
        },
      },
    });
  });
  await page.route(`${API}/role-skill-demand`, (route) =>
    route.fulfill({ json: { data: SKILL_DEMAND } }),
  );
  await page.route(`${API}/notifications**`, (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const unreadCount = notes.filter((item) => item.readAt === null).length;
    if (url.pathname.endsWith('/notifications') && method === 'GET') {
      if (url.searchParams.get('cursor')) {
        const more = Array.from({ length: 20 }, (_, index) =>
          note(100 + index, { title: `Раннее событие ${index + 1}`, createdAt: OLD, readAt: OLD }),
        );
        return route.fulfill({ json: { data: { items: more, unreadCount, nextCursor: null } } });
      }
      const nextCursor = mocks.hasMore ? 'c2' : null;
      return route.fulfill({ json: { data: { items: notes, unreadCount, nextCursor } } });
    }
    if (url.pathname.endsWith('/read-all') && method === 'PUT') {
      calls.readAll += 1;
      notes = notes.map((item) => ({ ...item, readAt: item.readAt ?? OLD }));
      return route.fulfill({ json: { data: { updated: unreadCount } } });
    }
    const match = url.pathname.match(/notifications\/([0-9a-f-]{36})\/read$/u);
    if (match && method === 'PUT') {
      calls.read.push(match[1]);
      notes = notes.map((item) => (item.id === match[1] ? { ...item, readAt: OLD } : item));
      return route.fulfill({ json: { data: { id: match[1], readAt: OLD } } });
    }
    return route.fallback();
  });
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cabinet-b640')).toBeVisible({ timeout: 15_000 });
  return calls;
}

const today = (page: Page) => page.locator('[data-b640-node="s03"]');
const feed = (page: Page) => page.locator('[data-b640-node="n01b"]');

test.describe('B650: «Сегодня» нового кабинета', () => {
  test('«Ищу работу»: статус, первое действие дня и остальные дела; гейты', async ({ page }) => {
    await openCabinet(page, '/app/today');
    const screen = today(page);
    await expect(screen.locator('.s5-prog')).toContainText('Статус: Ищу работу');
    await expect(screen.locator('.lead .lead-title')).toHaveText(
      'Напомнить компании Ozon про ответ',
    );
    await expect(screen.locator('.ev-row').first()).toBeVisible();
    await expect(screen.getByRole('heading', { name: 'Один вопрос о профиле' })).toBeVisible();
    await expect(page.locator('.b640 .is-primary:visible')).toHaveCount(1);
    await expectGates(page);

    await page.locator('.b640 a.is-primary:visible').click();
    await expect(page).toHaveURL(/\/app\/responses\/app-b232-1$/u);
  });

  test('«Сменить» ведёт к выбору статуса, у колокольчика число новых', async ({ page }) => {
    await openCabinet(page, '/app/today');
    await expect(page.locator('.b640 .bell:visible .dot')).toHaveText('2');
    await today(page).getByRole('link', { name: 'Сменить' }).click();
    await expect(page).toHaveURL(/\/app\/profile\/status$/u);
  });

  test('«Вернуть прежний»: статус возвращается на месте', async ({ page }) => {
    const calls = await openCabinet(page, '/app/today', { status: 'working', revert: true });
    const screen = today(page);
    await expect(screen.locator('.undo')).toContainText('Статус: Работаю');
    await expect(screen.getByRole('heading', { name: 'План на первые 90 дней' })).toBeVisible();
    await expect(screen.getByText('Ближайшая встреча')).toHaveCount(0);
    await screen.getByRole('button', { name: 'Вернуть прежний' }).click();
    await expect(screen.locator('.res-row')).toHaveText('Статус возвращён: Ищу работу');
    await expect(screen.locator('.s5-prog')).toContainText('Статус: Ищу работу');
    expect(calls.reverted).toBe(1);
  });

  test('«Меняю профессию»: требования роли, причина смены не показана; гейты', async ({ page }) => {
    await openCabinet(page, '/app/today', { status: 'changing_profession' });
    const screen = today(page);
    await expect(screen.locator('.lead-title')).toHaveText(
      '2 из 4 частых требований у вас уже есть',
    );
    await expect(screen.locator('.reqs .have li')).toHaveCount(2);
    await expect(screen.locator('.reqs .lack li')).toHaveCount(2);
    await expect(screen.getByText('Почему вы меняете профессию')).toHaveCount(0);
    await expectGates(page);
  });

  test('«Ищу, кем работать» и «Присматриваюсь» показывают вакансии с совпадением', async ({
    page,
  }) => {
    await openCabinet(page, '/app/today', { status: 'choosing_role' });
    await expect(today(page).locator('.lead-title')).toContainText('Ближе всего — роль');
    await expect(today(page).locator('.mod .rows .row').first()).toBeVisible();
    await expectGates(page);
  });

  test('ошибка чтения: строка на месте и «Повторить»', async ({ page }) => {
    await openCabinet(page, '/app/today', { statusFailures: 1 });
    const screen = today(page);
    await expect(screen.getByRole('alert')).toContainText('Не удалось загрузить «Сегодня».');
    await screen.getByRole('button', { name: 'Повторить' }).click();
    await expect(screen.locator('.s5-prog')).toBeVisible();
  });
});

test.describe('B650: «Сегодня» на данных в форме прода', () => {
  test('первое дело, посты без служебной приписки, одна залитая кнопка; гейты', async ({
    page,
  }) => {
    await openCabinet(page, '/app/today', { prodDay: true });
    const screen = today(page);
    await expect(screen.locator('.lead .lead-title')).toHaveText(
      'Напомнить компании Snowflake про ответ',
    );
    await expect(screen.locator('.lead .lead-sub')).toContainText('ответа нет 47 дней');
    await expect(screen.locator('.s5-prog')).toContainText('13 откликов → 1 интервью → 1 оффер');
    await expect(screen.locator('.ev-row')).toHaveCount(2);
    await expect(screen.locator('.ev-row .row-sub').first()).toHaveText('LinkedIn');
    await expect(screen.getByText('сам не опубликуется')).toHaveCount(0);
    await expect(page.locator('.b640 .is-primary:visible')).toHaveCount(1);
    await expectGates(page);
  });

  test('первый ответ оборвался по ожиданию: экран дочитывает сам, ошибки нет', async ({ page }) => {
    await openCabinet(page, '/app/today', { prodDay: true, dayFailures: 1 });
    const screen = today(page);
    await expect(screen.locator('.lead .lead-title')).toHaveText(
      'Напомнить компании Snowflake про ответ',
    );
    await expect(screen.getByRole('alert')).toHaveCount(0);
  });

  test('три сбоя подряд: ошибка на месте, причина в консоли, «Повторить» читает заново', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await openCabinet(page, '/app/today', { prodDay: true, dayFailures: 3 });
    const screen = today(page);
    await expect(screen.getByRole('alert')).toContainText('Не удалось загрузить дела на сегодня.');
    expect(errors.some((text) => text.includes('B640 «Сегодня»: не прочитали дела дня'))).toBe(
      true,
    );
    await screen.getByRole('button', { name: 'Повторить' }).click();
    await expect(screen.locator('.lead .lead-title')).toHaveText(
      'Напомнить компании Snowflake про ответ',
    );
  });
});

test.describe('B650: «Все уведомления»', () => {
  test('события по дням, действие ведёт в раздел и отмечает прочитанным; гейты', async ({
    page,
  }) => {
    const calls = await openCabinet(page, '/app/notifications');
    const screen = feed(page);
    await expect(screen.locator('#nt-title')).toHaveText('2 новых');
    await expect(screen.locator('.np-group')).toHaveText(['Сегодня', 'Раньше']);
    await expect(screen.locator('.notif.unread')).toHaveCount(2);
    await expect(screen.locator('.notif .is-primary')).toHaveCount(1);
    await expectGates(page);

    await screen.locator('.notif').first().getByRole('link', { name: 'Открыть отклик' }).click();
    await expect(page).toHaveURL(/\/app\/responses\/app-1$/u);
    expect(calls.read).toHaveLength(1);
  });

  test('«Отметить всё прочитанным» обнуляет счётчик на месте', async ({ page }) => {
    const calls = await openCabinet(page, '/app/notifications');
    const screen = feed(page);
    await screen.getByRole('button', { name: 'Отметить всё прочитанным' }).click();
    await expect(screen.locator('#nt-title')).toHaveText('Новых нет');
    await expect(screen.locator('.notif.unread')).toHaveCount(0);
    await expect(screen.getByRole('button', { name: 'Отметить всё прочитанным' })).toHaveCount(0);
    expect(calls.readAll).toBe(1);
  });

  test('«Показать ещё 20» догружает следующую порцию', async ({ page }) => {
    await openCabinet(page, '/app/notifications', { hasMore: true });
    const screen = feed(page);
    await expect(screen.locator('.notif')).toHaveCount(4);
    await screen.getByRole('button', { name: 'Показать ещё 20' }).click();
    await expect(screen.locator('.notif')).toHaveCount(24);
    await expect(screen.getByRole('button', { name: 'Показать ещё 20' })).toHaveCount(0);
  });

  test('пусто: одна строка, настройки рядом', async ({ page }) => {
    await openCabinet(page, '/app/notifications', { notes: [] });
    const screen = feed(page);
    await expect(screen.locator('.np-empty-t')).toHaveText('Новых уведомлений нет');
    await screen.getByRole('link', { name: 'Настройки уведомлений' }).click();
    await expect(page).toHaveURL(/\/app\/account\/notifications$/u);
  });
});

test.describe('B650: флаг выключен', () => {
  test('прежний кабинет не читает статус и модули нового «Сегодня»', async ({ page }) => {
    const statusRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/candidate/status')) statusRequests.push(request.url());
    });
    await mockSignedInCabinet(page);
    await page.goto('/app', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('cabinet-b640')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(statusRequests).toEqual([]);
  });
});

test.describe('B650: снимки для сверки с макетами', () => {
  const SCREENS: readonly (readonly [string, string, Mocks])[] = [
    ['today-job-search', '/app/today', {}],
    ['today-after-change', '/app/today', { status: 'changing_profession', revert: true }],
    ['today-choosing-role', '/app/today', { status: 'choosing_role' }],
    ['today-looking', '/app/today', { status: 'looking' }],
    ['today-working', '/app/today', { status: 'working' }],
    ['today-prod-day', '/app/today', { prodDay: true }],
    ['notifications', '/app/notifications', { hasMore: true }],
    ['notifications-empty', '/app/notifications', { notes: [] }],
  ];

  for (const [name, path, mocks] of SCREENS) {
    test(`снимки: ${name}`, async ({ page }, testInfo) => {
      test.skip(!SHOTS, 'снимки снимаются по запросу: B640_SHOTS=1');
      mkdirSync('.s13-shots', { recursive: true });
      const desktop = testInfo.project.name === 'desktop-1440';
      const widths = desktop ? [1440, 1176] : [390];
      await openCabinet(page, path, mocks);
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
