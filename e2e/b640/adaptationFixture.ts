import type { Page, Route } from '@playwright/test';

/** Сеть экранов «Адаптации» (B663): план 30-60-90, шаги, первая встреча и карта людей. */
export interface AdaptationCalls {
  readonly plans: unknown[];
  readonly details: unknown[];
  readonly people: Array<{ method: string; path: string; body: unknown }>;
}

const START = '2026-12-01';
const WORKPLACE = {
  id: 'w1', company: 'Вектор Банк', title: 'руководитель разработки', startDate: START, endDate: null,
  sourceExperienceId: null, status: 'active', isPrimary: true, createdAt: '2026-11-14T10:00:00.000Z', updatedAt: '2026-11-14T10:00:00.000Z',
};
type Task = { id: string; title: string; stage: string; dueDate: string; completed: boolean; step: string | null; group: string | null };
const t = (id: string, title: string, stage: string, dueDate: string, completed: boolean, step: string | null, group: string | null): Task =>
  ({ id, title, stage, dueDate, completed, step, group });
const TASKS: Task[] = [
  t('a1', 'Дата и время выхода, куда прийти', 'prep', '2026-11-25', true, 'before_start', 'Уточнить у HR'),
  t('a2', 'Когда выдадут ноутбук и доступы', 'prep', '2026-11-27', true, 'before_start', 'Уточнить у HR'),
  t('a3', 'Скрыть резюме на hh.ru', 'prep', '2026-11-25', false, 'before_start', 'Закрыть дела на старой работе'),
  t('b1', 'Почта, мессенджер, календарь', 'days_1_30', '2026-12-01', true, 'first_two_weeks', 'Доступы'),
  t('b2', 'Встречи один на один с 9 людьми', 'days_1_30', '2026-12-11', true, 'first_two_weeks', 'Встречи один на один'),
  t('c1', 'Что для вас успех к 90-му дню и как он измеряется?', 'days_1_30', '2026-12-02', true, 'first_meeting', null),
  t('d1', 'Своя тестовая среда для команды', 'days_31_60', '2027-01-15', false, null, null),
  t('d2', 'Релиз за неделю 4 недели подряд', 'days_31_60', '2027-01-29', false, null, null),
  t('e1', 'Итог 90 дней для директора', 'days_61_90', '2027-03-01', false, null, null),
  t('f1', 'Зарплатная карта банка', 'days_1_30', '2026-12-04', true, 'settling', 'Банк'),
];

const PLANNING = {
  adaptationPlan: {
    id: 'plan-1', workplaceId: 'w1', startDate: START, createdAt: '2026-11-14T10:00:00.000Z', status: 'active', closedAt: null,
    tasks: TASKS.map(({ id, title, stage, dueDate, completed }) => ({
      id, title, description: '', stage, category: 'delivery', dueDate, completed, source: 'template',
    })),
  },
};

function stageView(stage: string, title: string, status: string) {
  const tasks = TASKS.filter((task) => task.stage === stage).map((task) => ({ ...task, description: '', source: 'template', goalId: null }));
  return { stage, title, goalId: null, tasks, tasksTotal: tasks.length, tasksDone: tasks.filter((task) => task.completed).length, status };
}

function stepView(id: string, status: string) {
  const tasks = TASKS.filter((task) => task.step === id).map((task) => ({ ...task, description: '', source: 'template', goalId: null }));
  const names = [...new Set(tasks.map((task) => task.group))];
  return {
    id, status, tasksTotal: tasks.length, tasksDone: tasks.filter((task) => task.completed).length,
    groups: names.map((name) => ({ name, tasks: tasks.filter((task) => task.group === name) })),
  };
}

export const VIEW = {
  workplaceId: 'w1', hasPlan: true, startDate: START, dayNumber: 34,
  stages: [
    stageView('prep', '', 'done'),
    stageView('days_1_30', 'познакомиться с командой', 'done'),
    stageView('days_31_60', 'первый заметный результат', 'active'),
    stageView('days_61_90', 'цели команды на год', 'ahead'),
  ],
  steps: [
    stepView('before_start', 'done'), stepView('first_two_weeks', 'done'), stepView('first_meeting', 'done'),
    stepView('people_map', 'active'), stepView('day_30_check', 'ahead'), stepView('settling', 'done'),
  ],
  probation: { endsOn: '2027-03-01', reviewer: 'Ирина Лаврова, директор по технологиям' },
  firstMeeting: {
    heldOn: '2026-12-02', expectations: 'Релизы предсказуемые, команда не теряет людей',
    successByDay90: 'Релиз за неделю, 2 вакансии закрыты, никто не ушёл', measures: 'Срок релиза в днях, закрытые вакансии',
    cadence: 'Раз в 2 недели по средам', needsApproval: 'Выкладки в периоды отчётности', ownDecisions: 'Найм в рамках бюджета',
    manager: 'Ирина Лаврова, директор по технологиям',
  },
  relocated: false,
};

const person = (id: string, name: string, role: string, group: string, cadence: string, lastMetOn: string | null, status: string, headcount = 1) =>
  ({ id, name, role, group, cadence, headcount, lastMetOn, meeting: null, createdAt: '', status });
export const PEOPLE = {
  workplaceId: 'w1', total: 13, withoutMeeting: 2, nextMeeting: null,
  groups: [
    { name: 'Руководитель', headcount: 1, people: [person('p1', 'Ирина Лаврова', 'директор по технологиям', 'Руководитель', 'biweekly', '2026-12-09', 'met')] },
    { name: 'Команда', headcount: 9, people: [
      person('p2', 'Илья', 'ведущий разработчик', 'Команда', 'biweekly', '2026-12-30', 'met'),
      person('p3', '', '', 'Команда', 'biweekly', '2026-12-28', 'met', 8),
    ] },
    { name: 'Соседние команды', headcount: 3, people: [
      person('p4', '', 'Руководитель тестовых сред', 'Соседние команды', 'on_demand', null, 'none'),
      person('p5', '', 'Отдел найма', 'Соседние команды', 'weekly', '2026-12-29', 'met'),
      person('p6', '', 'Руководитель эксплуатации', 'Соседние команды', 'on_demand', null, 'none'),
    ] },
  ],
};

function handle(route: Route, calls: AdaptationCalls) {
  const request = route.request();
  const method = request.method();
  const path = new URL(request.url()).pathname.replace('/api/v1/candidate/career-diary', '');
  const body = method === 'GET' || method === 'DELETE' ? null : (request.postDataJSON() as unknown);
  if (path === '' || path === '/') return route.fulfill({ json: { data: { asOf: '2027-01-03', primaryWorkplace: WORKPLACE, summary: {} } } });
  if (path === '/workplaces/w1' && method === 'GET') return route.fulfill({ json: { data: { ...WORKPLACE, planning: PLANNING } } });
  if (path === '/workplaces/w1' && method === 'PATCH') {
    calls.plans.push(body);
    return route.fulfill({ json: { data: { ...WORKPLACE, ...(body as object) } } });
  }
  if (path === '/workplaces/w1/adaptation') {
    if (method === 'PATCH') calls.details.push(body);
    return route.fulfill({ json: { data: method === 'PATCH' ? { ...VIEW, ...(body as object) } : VIEW } });
  }
  if (path.startsWith('/workplaces/w1/people')) {
    if (method !== 'GET') calls.people.push({ method, path, body });
    return route.fulfill({ status: method === 'POST' ? 201 : 200, json: { data: PEOPLE } });
  }
  return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Нет' } } });
}

export async function mockAdaptation(page: Page): Promise<AdaptationCalls> {
  const calls: AdaptationCalls = { plans: [], details: [], people: [] };
  await page.route('**/api/v1/candidate/career-diary**', (route) => handle(route, calls));
  return calls;
}
