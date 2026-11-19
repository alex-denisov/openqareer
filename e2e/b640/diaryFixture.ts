import type { Page, Route } from '@playwright/test';

/** Маршруты дневника B683/B684 для e2e «Дневника» (данные из макета d00). */

export interface DiaryCalls {
  created: unknown[];
  deleted: string[];
  weeks: unknown[];
  measurements: unknown[];
  goals: unknown[];
  archived: unknown[];
}

function isoDay(offsetDays: number): string {
  const now = new Date();
  const local = new Date(
    now.getTime() - now.getTimezoneOffset() * 60_000 + offsetDays * 86_400_000,
  );
  return local.toISOString().slice(0, 10);
}

function monday(date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  const weekday = new Date(time).getUTCDay() || 7;
  return new Date(time - (weekday - 1) * 86_400_000).toISOString().slice(0, 10);
}

const TODAY = isoDay(0);
export const CURRENT_WEEK = monday(TODAY);

const ENTRY_TEXTS = [
  ['result', 'Релиз 2.14 вышел за 5 дней от сборки до выкладки.', 'goal-1'],
  ['problem', 'Тестовую среду ждали 4 дня: соседняя команда держала её под свой релиз.', 'goal-1'],
  ['meeting', 'Финальное интервью кандидата на первую вакансию перенесли на 12 января.', 'goal-2'],
  ['result', 'Релиз за 7 дней — первый раз уложились в неделю.', 'goal-1'],
  ['note', 'Директор отменил переход на общий конвейер сборки: банк меняет платформу.', null],
  ['result', 'Релиз за 9 дней: убрали ручное согласование выкладки.', 'goal-1'],
  ['problem', 'Посчитала инциденты после релизов: 6 за последний месяц.', null],
  ['note', 'Директор прислал цели квартала, договорились в переписке.', null],
] as const;
const DAY_OFFSETS = [0, -3, -4, -9, -11, -18, -25, -26];

function entries() {
  return ENTRY_TEXTS.map(([kind, text, goalId], index) => {
    const date = isoDay(DAY_OFFSETS[index]!);
    return {
      id: `e${index + 1}`,
      date,
      weekStart: monday(date),
      kind,
      text,
      goalId,
      createdAt: `${date}T10:00:00.000Z`,
      updatedAt: `${date}T10:00:00.000Z`,
    };
  });
}

function goal(
  id: string,
  title: string,
  unit: string,
  baseline: number,
  target: number,
  latest: number | null,
) {
  return {
    id,
    title,
    type: 'operational',
    horizon: 'quarter',
    startDate: isoDay(-40),
    dueDate: isoDay(50),
    unit,
    baselineValue: baseline,
    targetValue: target,
    valueSource: 'candidate_entered',
    parentGoalId: null,
    isPrimary: false,
    createdAt: '',
    updatedAt: '',
    latestMeasurement:
      latest === null
        ? null
        : {
            id: `m-${id}`,
            goalId: id,
            value: latest,
            measuredAt: isoDay(-10),
            note: null,
            source: 'candidate_entered',
            createdAt: '',
          },
    risk: { status: 'on_track', rule: 'linear_progress_v1', explanation: '' },
  };
}

const CARDS = [
  {
    ...goal('goal-1', 'Выпускать релиз за неделю', 'дней', 14, 7, 7),
    details: { setBy: 'manager', agreedOn: null, weight: null, archive: null },
    indicators: [goal('ind-1', 'Срок релиза', 'дней', 14, 7, 7)],
  },
  {
    ...goal('goal-2', 'Закрыть 2 вакансии в команду', 'вакансий', 0, 2, 0),
    dueDate: isoDay(70),
    risk: { status: 'at_risk', rule: 'linear_progress_v1', explanation: '' },
    details: { setBy: 'manager', agreedOn: null, weight: null, archive: null },
    indicators: [goal('ind-2', 'Закрыто вакансий', '', 0, 2, 0)],
  },
];

const ARCHIVED = [
  {
    ...goal('goal-3', 'Перевести сборку на общий конвейер', '', 0, 1, null),
    details: {
      setBy: 'manager',
      agreedOn: null,
      weight: null,
      archive: { archivedAt: '', reason: 'Банк меняет платформу' },
    },
    indicators: [],
  },
];

const HISTORY = [7, 9, 11, 14].map((value, index) => ({
  id: `h${index}`,
  goalId: 'ind-1',
  value,
  measuredAt: isoDay(-10 - index * 7),
  note: index === 1 ? 'Убрали ручное согласование' : null,
  source: 'candidate_entered',
  createdAt: '',
}));

function weekDraft(weekStart: string, items: ReturnType<typeof entries>) {
  const week = items.filter((item) => item.weekStart === weekStart);
  return {
    weekStart,
    entries: week,
    achievedEntryIds: week
      .filter((item) => item.kind === 'result' || item.kind === 'meeting')
      .map((item) => item.id),
    blockers: week
      .filter((item) => item.kind === 'problem')
      .map((item) => item.text)
      .join('\n'),
    plan: [
      { text: 'Разобрать, где ждёт релиз', goalId: 'goal-1', source: 'goal_at_risk' },
      { text: 'Договориться о тестовой среде', goalId: null, source: 'carried' },
    ],
    saved: null,
  };
}

async function handle(
  route: Route,
  calls: DiaryCalls,
  state: { items: ReturnType<typeof entries> },
) {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.replace('/api/v1/candidate/career-diary', '');
  const method = request.method();
  if (path === '' || path === '/') {
    return route.fulfill({
      json: {
        data: { asOf: TODAY, platformStartedAt: isoDay(-30), primaryWorkplace: null, summary: {} },
      },
    });
  }
  if (path === '/goal-cards' && method === 'GET')
    return route.fulfill({ json: { data: { items: CARDS, archived: ARCHIVED } } });
  if (path === '/goal-cards' && method === 'POST') {
    calls.goals.push(request.postDataJSON());
    return route.fulfill({ status: 201, json: { data: { ...CARDS[0], id: 'goal-new' } } });
  }
  const archive = /^\/goal-cards\/([^/]+)\/archive$/u.exec(path);
  if (archive) {
    calls.archived.push({ id: archive[1], method, body: request.postDataJSON() });
    return route.fulfill({ json: { data: CARDS[0] } });
  }
  if (/^\/goals\/[^/]+\/measurements$/u.test(path) && method === 'GET')
    return route.fulfill({ json: { data: { items: HISTORY, nextCursor: null } } });
  if (path === '/entries' && method === 'GET') {
    const kind = url.searchParams.get('kind');
    const goalId = url.searchParams.get('goalId');
    const items = state.items.filter(
      (item) => (!kind || item.kind === kind) && (!goalId || item.goalId === goalId),
    );
    return route.fulfill({ json: { data: { items, nextCursor: null, summaries: [] } } });
  }
  if (path === '/entries' && method === 'POST') {
    const body = request.postDataJSON() as Record<string, string>;
    calls.created.push(body);
    const created = {
      ...body,
      id: `n${calls.created.length}`,
      weekStart: monday(body.date!),
      goalId: body.goalId ?? null,
      createdAt: `${body.date}T12:00:00.000Z`,
      updatedAt: '',
    };
    state.items = [created as (typeof state.items)[number], ...state.items];
    return route.fulfill({ status: 201, json: { data: created } });
  }
  const entry = /^\/entries\/([^/]+)$/u.exec(path);
  if (entry && method === 'DELETE') {
    calls.deleted.push(entry[1]!);
    state.items = state.items.filter((item) => item.id !== entry[1]);
    return route.fulfill({ json: { data: { deleted: true } } });
  }
  const week = /^\/weeks\/([^/]+)$/u.exec(path);
  if (week && method === 'GET')
    return route.fulfill({ json: { data: weekDraft(week[1]!, state.items) } });
  if (week && method === 'PUT') {
    calls.weeks.push(request.postDataJSON());
    return route.fulfill({
      json: {
        data: {
          ...(request.postDataJSON() as object),
          weekStart: week[1],
          createdAt: '',
          updatedAt: '',
        },
      },
    });
  }
  if (/^\/goals\/[^/]+\/measurements$/u.test(path) && method === 'POST') {
    calls.measurements.push(request.postDataJSON());
    return route.fulfill({ status: 201, json: { data: {} } });
  }
  return route.fulfill({ status: 404, json: { error: { code: 'not_found' } } });
}

/** Ставит маршруты дневника поверх общего фикстура кабинета. */
export async function mockDiary(page: Page): Promise<DiaryCalls> {
  const calls: DiaryCalls = {
    created: [],
    deleted: [],
    weeks: [],
    measurements: [],
    goals: [],
    archived: [],
  };
  const state = { items: entries() };
  await page.route('**/api/v1/candidate/career-diary**', (route) => handle(route, calls, state));
  return calls;
}
