import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { mockSignedInCabinet } from '../fixtures/mockSignedInCabinet';
import { expectGates, type GateName } from './gates';

const SHOTS = process.env.B640_SHOTS;
const GATES_BESIDE_SECTION: readonly GateName[] = [
  'first_screen',
  'primary_pinned',
  'spacing',
  'modal_fit',
  'field_height',
  'desktop_bottom',
];

const FEED = [
  { id: 'u1', role: 'user', content: 'Почему у Ладога Банка 86 %, а у Гринкода только 81?' },
  {
    id: 'a1',
    role: 'assistant',
    content:
      'В Ладога Банке 6 из 7 требований есть в вашем профиле. Не хватает одного: «опыт в платёжных системах от 3 лет».',
  },
  { id: 'u2', role: 'user', content: 'Да, там была платёжная платформа. Команда была 18 человек.' },
  {
    id: 'a2',
    role: 'assistant',
    content:
      'Принято. Это нужно **записать в профиль**, иначе процент будет ниже:\n1. **Команда**: 18 человек\n2. Платёжная платформа',
  },
];

const FACT = {
  id: 'fact-1',
  kind: 'fact',
  domain: 'outcome',
  statement: 'Сфера Платежи — команда 18 человек',
  confidence: 'candidate-reported',
  sourceMessageIds: ['u2'],
  sensitive: false,
  status: 'proposed',
};

const STATUS_TODAY = {
  status: 'job_search',
  title: 'Ищу работу',
  chosen: true,
  modules: [
    { key: 'next_action', title: 'Следующее действие' },
    { key: 'applications_summary', title: 'Ваши отклики' },
    { key: 'profile_question', title: 'Один вопрос о профиле' },
  ],
  revert: null,
};

const TOPICS = [
  'Почему у Ладога Банка 86 %, а у Гринкода только 81',
  'Что проверить в моём профиле перед откликами в банки',
  'Как ответить про уход из Финтех Лаб',
  'Кому напомнить о себе на этой неделе',
];

function conversation(id: string, firstPhrase: string) {
  return {
    id,
    stage: 'vacancies',
    openedAt: '2026-11-10T10:00:00.000Z',
    lastMessageAt: '2026-11-10T10:05:00.000Z',
    closedAt: '2026-11-10T11:00:00.000Z',
    messageCount: 2,
    firstPhrase,
    summary: '**Что выяснили**\n- В шапке резюме есть три утверждения\n- Нет цифр',
  };
}

interface ConsultantMocks {
  readonly turn?: 'ok' | 'fail' | 'limit';
  readonly history?: 'two-pages' | 'empty';
  readonly memory?: readonly unknown[];
  readonly replies?: readonly unknown[];
  /** Сколько первых чтений разговора фоновый разбор ещё идёт: до того ответов с действиями нет. */
  readonly pendingReads?: number;
  /** B746: первый ход с объектом экрана получает «Объект не найден». */
  readonly subjectMissing?: boolean;
}

async function openConsultant(page: Page, path: string, mocks: ConsultantMocks = {}) {
  const calls = await mockConsultant(page, mocks);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.b640 aside.panel-col')).toBeVisible({ timeout: 15_000 });
  return calls;
}

/** Открыть панель кнопкой над экраном: на 390 — ссылкой в шапке, на 1440 — кнопкой панели. */
async function openPanelOver(page: Page, mobile: boolean) {
  const open = mobile
    ? page.getByRole('link', { name: /Консультант: открыть/u })
    : page.locator('.b640 .top-actions .btn-panel');
  await open.click({ timeout: 15_000 });
  const panel = page.locator('.b640 .app.has-panel > aside.panel-col');
  await expect(panel).toBeVisible();
  return panel;
}

async function mockConsultant(page: Page, mocks: ConsultantMocks = {}) {
  await mockSignedInCabinet(page, { cabinetB640: true });
  const memory = [...(mocks.memory ?? [FACT])];
  const sent: { key: string | undefined; content: string; subject?: unknown }[] = [];
  // Раздел под панелью живой: «Сегодня» и число у колокольчика.
  await page.route('**/api/v1/candidate/status/today', (route) =>
    route.fulfill({ json: { data: { today: STATUS_TODAY } } }),
  );
  await page.route('**/api/v1/candidate/notifications?**', (route) =>
    route.fulfill({ json: { data: { items: [], unreadCount: 2, nextCursor: null } } }),
  );
  const feed = [...FEED];
  await page.route('**/api/v1/candidate/me/messages**', (route) =>
    route.fulfill({ json: { data: feed, meta: { nextOffset: null } } }),
  );
  // Голова снимка: записи из разговора приходят вместе с ней.
  await page.route('**/api/v1/candidate/me?memoryOffset=*', (route) =>
    route.fulfill({
      json: {
        data: {
          candidate: {
            id: 'candidate-1',
            dataClass: 'synthetic',
            locale: 'ru-RU',
            createdAt: '2026-10-01T10:00:00.000Z',
          },
          messages: [],
          memory,
          turns: [],
        },
        meta: { memory: { nextOffset: null }, turns: { nextOffset: null } },
      },
    }),
  );
  await page.route('**/api/v1/candidate/billing/quotas', (route) =>
    route.fulfill({
      json: {
        data: {
          plan: 'free',
          unlimited: false,
          period: { startedAt: '2026-10-20T00:00:00.000Z', endsAt: '2026-11-20T09:00:00.000Z' },
          quotas: [
            {
              key: 'coach_turns',
              label: 'Сообщения консультанту',
              limit: 30,
              used: 18,
              remaining: 12,
              upgradePlan: 'basic',
            },
          ],
          fitPercentLimit: null,
        },
      },
    }),
  );
  await page.route('**/api/v1/candidate/memory/*', (route) => {
    memory.length = 0;
    return route.fulfill({ status: 200, json: { data: { ok: true } } });
  });
  await page.route('**/api/v1/coach/turn*', (route) => {
    const body = route.request().postDataJSON() as { content: string; subject?: unknown };
    sent.push({
      key: route.request().headers()['idempotency-key'],
      content: body.content,
      subject: body.subject,
    });
    if (mocks.subjectMissing && body.subject) {
      return route.fulfill({
        status: 404,
        json: {
          error: { code: 'subject_not_found', message: 'Объект не найден.', retryable: false },
        },
      });
    }
    if (mocks.turn === 'limit') {
      return route.fulfill({
        status: 402,
        json: {
          error: {
            code: 'quota_exhausted',
            message: 'Сообщения по тарифу закончились.',
            details: { quota: 'coach_turns', upgradePlan: 'basic' },
          },
        },
      });
    }
    if (mocks.turn === 'fail' && sent.length === 1) {
      return route.fulfill({
        status: 502,
        json: { error: { code: 'provider_failed', message: 'Сбой.', retryable: true } },
      });
    }
    const answer = 'Гринкод просит «собрать команду с нуля». Как было у вас?';
    feed.push(
      { id: `u-${sent.length}`, role: 'user', content: body.content },
      { id: `a-${sent.length}`, role: 'assistant', content: answer },
    );
    return route.fulfill({
      json: {
        data: {
          message: answer,
          phase: 'discovery',
          nextQuestion: null,
          completeness: { known: [], unknown: [] },
          safety: { needsHuman: false, reason: null },
          careerTrack: null,
          actionProposals: [],
        },
      },
    });
  });
  const consultant = {
    open: true,
    closed: 0,
    reads: 0,
    resumed: [] as string[],
    confirmed: [] as string[],
  };
  await page.route('**/api/v1/candidate/consultant/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/current')) {
      consultant.reads += 1;
      const pending = consultant.reads <= (mocks.pendingReads ?? 0);
      const data = consultant.open
        ? {
            ...conversation('current', TOPICS[0]),
            closedAt: null,
            messages: feed,
            replies: pending ? [] : (mocks.replies ?? []),
            analysisPending: pending,
          }
        : null;
      return route.fulfill({ json: { data } });
    }
    if (path.endsWith('/current/close')) {
      consultant.open = false;
      consultant.closed += 1;
      feed.length = 0;
      return route.fulfill({ json: { data: { closedId: 'current' } } });
    }
    const resumed = /\/conversations\/([^/]+)\/resume$/u.exec(path);
    if (resumed) {
      consultant.resumed.push(resumed[1]);
      consultant.open = true;
      feed.splice(0, feed.length, ...FEED);
      return route.fulfill({
        json: { data: { ...conversation(resumed[1], TOPICS[0]), closedAt: null, messages: feed } },
      });
    }
    const fact = /\/facts\/([^/]+)\/confirm$/u.exec(path);
    if (fact) {
      consultant.confirmed.push(fact[1]);
      memory.length = 0;
      return route.fulfill({ json: { data: { changeId: 'change-1' } } });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Нет.' } } });
  });
  await page.route('**/api/v1/candidate/consultant-history**', (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/consultant-history/')[1];
    if (id) {
      return route.fulfill({
        json: {
          data: {
            ...conversation(id, TOPICS[0]),
            messages: FEED.map((message) => ({
              ...message,
              createdAt: '2026-11-10T10:00:00.000Z',
            })),
          },
        },
      });
    }
    if (mocks.history === 'empty') {
      return route.fulfill({ json: { data: [], meta: { nextCursor: null } } });
    }
    const second = url.searchParams.get('cursor') === 'page-2';
    const data = Array.from({ length: second ? 3 : 20 }, (_, index) => {
      const number = (second ? 20 : 0) + index;
      return conversation(`c${number}`, TOPICS[number % TOPICS.length]);
    });
    return route.fulfill({ json: { data, meta: { nextCursor: second ? null : 'page-2' } } });
  });
  return { sent, consultant };
}

test.describe('B660: «Консультант» нового кабинета', () => {
  test('разговор: панель в сетке, лента, запись в профиль, гейты', async ({ page }) => {
    const { consultant } = await openConsultant(page, '/app/consultant');
    const panel = page.locator('.b640 .app.has-panel > aside.panel-col');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-dialog', '1');
    await expect(panel.locator('.msg.me').first()).toHaveText(FEED[0].content);
    await expect(panel.locator('.ptop .pend')).toHaveText('1 запись ждёт проверки');
    // Разметка ответа показана как текст с выделением и списком, без звёздочек.
    const reply = panel.locator('.msg.bot').nth(1);
    await expect(reply.locator('strong').first()).toHaveText('записать в профиль');
    await expect(reply.locator('ol > li')).toHaveCount(2);
    await expect(reply).not.toContainText('**');
    const card = panel.locator('section.ec.fc');
    await expect(card.locator('.ec-title')).toHaveText(
      'Записать в профиль: Сфера Платежи — команда 18 человек',
    );
    await expectGates(page);
    await card.getByRole('button', { name: 'Верно' }).click();
    await expect(panel.locator('.chat .res-row')).toHaveText('Записано в профиль');
    expect(consultant.confirmed).toEqual([FACT.id]);
    await expect(panel.locator('.ptop')).toHaveCount(0);
    await expect(panel).not.toContainText(/пока недоступно|gemini|gpt|openrouter|vertex/iu);
  });

  test('вопрос и ответ на месте; ввод закреплён внизу панели', async ({ page }) => {
    const { sent } = await openConsultant(page, '/app/consultant', { memory: [] });
    const panel = page.locator('.b640 aside.panel-col');
    const field = panel.getByLabel('Ваш вопрос консультанту');
    await field.fill('А что с Гринкодом?');
    await field.press('Enter');
    await expect(panel.locator('.msg.me').last()).toHaveText('А что с Гринкодом?');
    await expect(panel.locator('.msg.bot').last()).toContainText('Гринкод просит');
    await expect(field).toHaveValue('');
    expect(sent).toHaveLength(1);
    const form = await panel.locator('form.compose').boundingBox();
    const view = page.viewportSize();
    expect(form && view && form.y + form.height).toBeLessThanOrEqual(view?.height ?? 0);
  });

  test('ответ не пришёл: «Повторить» шлёт тот же вопрос тем же ключом', async ({ page }) => {
    const { sent } = await openConsultant(page, '/app/consultant', { turn: 'fail', memory: [] });
    const panel = page.locator('.b640 aside.panel-col');
    const field = panel.getByLabel('Ваш вопрос консультанту');
    await field.fill('Как это сформулировать?');
    await field.press('Enter');
    const error = panel.locator('.chat > .res-row.is-err');
    await expect(error).toContainText('Ответ не пришёл');
    await expect(panel.locator('.msg.me').last()).toHaveText('Как это сформулировать?');
    await error.getByRole('button', { name: 'Повторить' }).click();
    await expect(panel.locator('.msg.bot').last()).toContainText('Гринкод просит');
    await expect(error).toHaveCount(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  test('предел сообщений: ввод закрыт, строка ведёт к тарифам', async ({ page }) => {
    await openConsultant(page, '/app/consultant', { turn: 'limit', memory: [] });
    const panel = page.locator('.b640 aside.panel-col');
    const field = panel.getByLabel('Ваш вопрос консультанту');
    await field.fill('Как это сформулировать?');
    await field.press('Enter');
    const line = panel.locator('form.compose.is-off .cmp-line');
    await expect(line).toContainText('Лимит сообщений исчерпан');
    await expect(field).toBeDisabled();
    await expectGates(page);
    await line.getByRole('link', { name: /Перейти на/u }).click();
    await expect(page).toHaveURL(/\/app\/tariffs$/u);
  });

  test('все разговоры: по 20, «Показать ещё», прошлый разговор и путь назад', async ({ page }) => {
    await openConsultant(page, '/app/consultant/history');
    const panel = page.locator('.b640 aside.panel-col');
    await expect(panel.locator('.ph-title')).toHaveText('Все разговоры');
    const rows = panel.locator('ul.hist.hist2 > li');
    await expect(rows).toHaveCount(20);
    // Строка — тема одной строкой: итог разговора и его разметка в неё не попадают.
    await expect(rows.first().locator('.hist-tt')).toHaveText(TOPICS[0]);
    await expect(panel.locator('ul.hist')).not.toContainText(/Что выяснили|\*\*/u);
    const row = await rows.first().boundingBox();
    expect(row?.height).toBeLessThanOrEqual(56);
    await expectGates(page);
    await panel.getByRole('button', { name: 'Показать ещё' }).click();
    await expect(rows).toHaveCount(23);
    await expect(panel.getByRole('button', { name: 'Показать ещё' })).toHaveCount(0);
    await rows.first().locator('a').click();
    await expect(page).toHaveURL(/\/app\/consultant\?conversation=c0$/u);
    await expect(panel.locator('.chat .day')).toHaveText('10 ноября');
    await expect(panel.locator('.msg.me').first()).toHaveText(FEED[0].content);
    await panel.getByRole('link', { name: 'Все разговоры' }).click();
    await expect(page).toHaveURL(/\/app\/consultant\/history$/u);
  });

  test('B688: под ответом своя запись с источником и шаг в раздел; записи на проверку в панели', async ({
    page,
  }) => {
    const record = {
      ...FACT,
      id: 'imp-1',
      statement: 'Руководитель группы бэкенда — Сфера Платежи, 2018–2021',
      status: 'confirmed',
      provenance: { kind: 'import', platform: 'hh', at: '2026-10-02T10:00:00.000Z' },
    };
    const { consultant } = await openConsultant(page, '/app/consultant', {
      memory: [FACT, record],
      replies: [{ messageId: 'a1', actions: ['profile', 'vacancies'], memoryIds: ['imp-1'] }],
    });
    const panel = page.locator('.b640 aside.panel-col');
    const reply = panel.locator('.msg.bot').first();
    await expect(reply.locator('.ref b')).toHaveText(record.statement);
    await expect(reply.locator('.ref .from')).toContainText('из hh.ru');
    await expect(reply.getByRole('link', { name: 'Открыть в профиле' })).toHaveAttribute(
      'href',
      '/app/profile',
    );
    await expect(reply.getByRole('link', { name: 'Открыть вакансии' })).toBeVisible();
    await expectGates(page);
    await panel.locator('.ptop .pend').click();
    await expect(page).toHaveURL(/\/app\/consultant\?review=1$/u);
    await expect(panel.locator('.ph-title')).toHaveText('Записи на проверку');
    const card = panel.locator('.rv-list section.ec.fc');
    await expect(card).toHaveCount(1);
    await expectGates(page);
    await card.getByRole('button', { name: 'Верно' }).click();
    await expect(panel.locator('.rv-list .res-row')).toHaveText('Записано в профиль');
    expect(consultant.confirmed).toEqual([FACT.id]);
    await panel.getByRole('link', { name: 'К разговору' }).click();
    await expect(page).toHaveURL(/\/app\/consultant$/u);
    await expect(panel).toHaveAttribute('data-b640-panel', 'dialog');
  });

  test('B688: «К разговору» из записей, открытых прямой ссылкой, возвращает разговор', async ({
    page,
  }) => {
    const { consultant } = await openConsultant(page, '/app/consultant?review=1', {
      memory: [FACT],
    });
    const panel = page.locator('.b640 aside.panel-col');
    await expect(panel.locator('.ph-title')).toHaveText('Записи на проверку');
    const readsBefore = consultant.reads;
    await panel.getByRole('link', { name: 'К разговору' }).click();
    await expect(page).toHaveURL(/\/app\/consultant$/u);
    await expect(panel).toHaveAttribute('data-b640-panel', 'dialog');
    await expect(panel.locator('.msg.bot').first()).toBeVisible();
    expect(consultant.reads).toBeGreaterThan(readsBefore);
  });

  test('B688: действия под ответом приходят, когда закончится фоновый разбор', async ({ page }) => {
    await openConsultant(page, '/app/consultant', {
      memory: [FACT],
      replies: [{ messageId: 'a1', actions: ['career'], memoryIds: [] }],
      pendingReads: 1,
    });
    const reply = page.locator('.b640 aside.panel-col .msg.bot').first();
    await expect(reply).toBeVisible();
    await expect(reply.getByRole('link', { name: 'Открыть «Карьеру»' })).toHaveCount(0);
    await expect(reply.getByRole('link', { name: 'Открыть «Карьеру»' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('B688: «Новый разговор» и продолжение прошлого из «Все разговоры»', async ({ page }) => {
    const { consultant } = await openConsultant(page, '/app/consultant');
    const panel = page.locator('.b640 aside.panel-col');
    await expect(panel.locator('.msg.me').first()).toHaveText(FEED[0].content);
    await panel.getByRole('button', { name: 'Новый разговор' }).click();
    await expect(panel.locator('.msg')).toHaveCount(0);
    expect(consultant.closed).toBe(1);
    await expect(panel.getByLabel('Ваш вопрос консультанту')).toBeVisible();
    await panel.getByRole('link', { name: 'Все разговоры' }).click();
    await panel.locator('ul.hist.hist2 > li').first().locator('a').click();
    await expect(page).toHaveURL(/\/app\/consultant\?conversation=c0$/u);
    await expect(panel.getByRole('button', { name: 'Новый разговор' })).toHaveCount(0);
    await expectGates(page);
    await panel.getByRole('button', { name: 'Продолжить разговор' }).click();
    await expect(page).toHaveURL(/\/app\/consultant$/u);
    await expect(panel.locator('.msg.me').first()).toHaveText(FEED[0].content);
    await expect(panel.getByLabel('Ваш вопрос консультанту')).toBeVisible();
    expect(consultant.resumed).toEqual(['c0']);
  });

  test('разговоров нет: одна строка и «Начать» открывает разговор', async ({ page }) => {
    await openConsultant(page, '/app/consultant/history', { history: 'empty' });
    const panel = page.locator('.b640 aside.panel-col');
    await expect(panel.locator('.vl-empty-t')).toHaveText('Разговоров пока нет');
    // «Начать» залита, как в макете k05b, и стоит рядом с главной кнопкой раздела под панелью:
    // правило «одна главная на экране» здесь нарушает сам макет, остальные шесть гейтов в силе.
    await expectGates(page, { only: GATES_BESIDE_SECTION });
    await panel.getByRole('button', { name: 'Начать' }).click();
    await expect(page).toHaveURL(/\/app\/consultant$/u);
    await expect(panel.getByLabel('Ваш вопрос консультанту')).toBeVisible();
  });

  test('B700: панель открывается над «Вакансиями» и закрывается без ухода с раздела', async ({
    page,
  }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-390';
    await mockConsultant(page);
    await page.goto('/app/vacancies', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-b640-node="s07"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.b640 aside.panel-col')).toHaveCount(0);
    const open = mobile
      ? page.getByRole('link', { name: /Консультант: открыть/u })
      : page.locator('.b640 .top-actions .btn-panel');
    await open.click();
    const panel = page.locator('.b640 .app.has-panel > aside.panel-col');
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/\/app\/vacancies$/u);
    await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-dialog', '1');
    await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-active', 'vacancies');
    await expect(panel.locator('.ph-conv')).toHaveText('Консультант · Вакансии');
    await expect(page.locator('.b640 .top-actions .btn-panel')).toHaveCount(0);
    await expect(panel.locator('.msg.me').first()).toHaveText(FEED[0].content);
    await expectGates(page);
    // Виды панели меняются на месте: адрес раздела не трогают.
    await panel.getByRole('link', { name: 'Все разговоры' }).click();
    await expect(panel.locator('ul.hist.hist2 > li')).toHaveCount(20);
    await expect(page).toHaveURL(/\/app\/vacancies$/u);
    await panel.getByRole('button', { name: 'Свернуть' }).click();
    await expect(page.locator('.b640 aside.panel-col')).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/vacancies$/u);
    await expect(page.locator('[data-b640-node="s07"]')).toBeVisible();
    await expect(page.getByTestId('cabinet-b640')).not.toHaveAttribute('data-dialog', '1');
  });

  test('B746: вопрос с подготовки к интервью уходит с откликом экрана', async ({
    page,
  }, testInfo) => {
    const calls = await mockConsultant(page);
    await page.goto('/app/responses/app-intouch/interview', { waitUntil: 'domcontentloaded' });
    const panel = await openPanelOver(page, testInfo.project.name === 'mobile-390');
    await panel.getByLabel('Ваш вопрос консультанту').fill('Что меня спросят на этом интервью?');
    await panel.getByLabel('Ваш вопрос консультанту').press('Enter');
    await expect(panel.locator('.msg.me').last()).toHaveText('Что меня спросят на этом интервью?');
    await expect.poll(() => calls.sent.length).toBe(1);
    expect(calls.sent[0]?.subject).toEqual({ kind: 'application', id: 'app-intouch' });
  });

  test('B783: вопрос с карточки компании уходит с компанией по ключу адреса', async ({
    page,
  }, testInfo) => {
    const calls = await mockConsultant(page);
    await page.goto('/app/vacancies/companies/intouchgroup', { waitUntil: 'domcontentloaded' });
    const panel = await openPanelOver(page, testInfo.project.name === 'mobile-390');
    await panel.getByLabel('Ваш вопрос консультанту').fill('Стоит ли сюда откликаться?');
    await panel.getByLabel('Ваш вопрос консультанту').press('Enter');
    await expect.poll(() => calls.sent.length).toBe(1);
    expect(calls.sent[0]?.subject).toEqual({ kind: 'company', id: 'intouchgroup' });
  });

  test('B746: объект не найден — тот же вопрос уходит без него, ответ приходит', async ({
    page,
  }, testInfo) => {
    const calls = await mockConsultant(page, { subjectMissing: true });
    await page.goto('/app/responses/app-gone/interview', { waitUntil: 'domcontentloaded' });
    const panel = await openPanelOver(page, testInfo.project.name === 'mobile-390');
    await panel.getByLabel('Ваш вопрос консультанту').fill('Что меня спросят?');
    await panel.getByLabel('Ваш вопрос консультанту').press('Enter');
    await expect(panel.locator('.msg').last()).toContainText('Гринкод');
    expect(calls.sent.map((turn) => turn.subject)).toEqual([
      { kind: 'application', id: 'app-gone' },
      undefined,
    ]);
    expect(calls.sent[1]?.key).toBe(calls.sent[0]?.key);
  });

  test('B700: адрес консультанта открывает панель над «Сегодня», гейты', async ({ page }) => {
    await openConsultant(page, '/app/consultant', { memory: [] });
    await expect(page.getByTestId('cabinet-b640')).toHaveAttribute('data-active', 'today');
    await expect(page.locator('[data-b640-node="s03"]')).toBeVisible();
    await expect(page.locator('[data-b640-node="s03"]')).toContainText('Ищу работу');
    await expect(page.locator('.b640 .bell:visible .dot')).toHaveText('2');
    await expect(page.locator('.b640 aside.panel-col .ph-conv')).toHaveText(
      'Консультант · Сегодня',
    );
    await expectGates(page);
  });

  test('«Свернуть» закрывает панель и возвращает в кабинет', async ({ page }) => {
    await openConsultant(page, '/app/consultant');
    await page.locator('.b640 aside.panel-col').getByRole('button', { name: 'Свернуть' }).click();
    await expect(page).toHaveURL(/\/app\/today$/u);
    await expect(page.locator('.b640 aside.panel-col')).toHaveCount(0);
    await expect(page.locator('.b640 .app.has-panel')).toHaveCount(0);
  });

  test('снимки «Консультанта»: 1440, 1176, 390, светлая и тёмная', async ({ page }, testInfo) => {
    test.skip(
      !SHOTS || testInfo.project.name !== 'desktop-1440',
      'снимки снимаются по запросу: B640_SHOTS=1',
    );
    test.setTimeout(180_000);
    mkdirSync('.s13-shots', { recursive: true });
    const views = [
      { name: 'k01', path: '/app/consultant', mocks: {} },
      { name: 'k05', path: '/app/consultant/history', mocks: {} },
      { name: 'k05b', path: '/app/consultant/history', mocks: { history: 'empty' } },
    ] as const;
    for (const theme of ['light', 'dark']) {
      await page.addInitScript(
        (value) => window.localStorage.setItem('oq_b640_theme', value),
        theme,
      );
      for (const view of views) {
        for (const [width, height] of [
          [1440, 900],
          [1176, 900],
          [390, 844],
        ]) {
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await page.setViewportSize({ width, height });
          await openConsultant(page, view.path, view.mocks);
          await page.locator('.b640 .chat').locator('> *').first().waitFor();
          await expect(page.locator('[data-b640-node="s03"]')).toContainText('Ищу работу');
          await page.screenshot({ path: `.s13-shots/${view.name}-${width}-${theme}.png` });
        }
      }
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
      ]) {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await page.setViewportSize({ width, height });
        await mockConsultant(page);
        await page.goto('/app/vacancies', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-b640-node="s07"]')).toBeVisible({ timeout: 15_000 });
        await page.locator(width < 768 ? '.b640 .mob-coach' : '.b640 .btn-panel').click();
        await page.locator('.b640 .chat').locator('> *').first().waitFor();
        await page.screenshot({ path: `.s13-shots/k01-vacancies-${width}-${theme}.png` });
      }
    }
  });
});
