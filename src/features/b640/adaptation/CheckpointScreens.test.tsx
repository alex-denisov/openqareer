// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { Day30Screen } from './Day30Screen';
import { ResultsScreen } from './ResultsScreen';

const api = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getWorkplace: vi.fn(),
  getAdaptation: vi.fn(),
  getPeople: vi.fn(),
  savePlan: vi.fn(),
  createWorkplace: vi.fn(),
  patchAdaptation: vi.fn(),
  addPerson: vi.fn(),
  updatePerson: vi.fn(),
  removePerson: vi.fn(),
  scheduleMeeting: vi.fn(),
}));
vi.mock('./adaptationApi', () => api);
const checks = vi.hoisted(() => ({ getDay30: vi.fn(), markDay30Sent: vi.fn(), unmarkDay30Sent: vi.fn(), getResults90: vi.fn() }));
vi.mock('./checkpointsApi', () => checks);
const writeText = vi.fn();

const session = { username: 'f.test', role: 'candidate', isTest: true, candidateId: 'c', features: { cabinetB640: true }, emailVerified: true } as AuthUser;
const WORKPLACE = { id: 'w1', company: 'Вектор Банк', title: 'руководитель разработки', startDate: '2026-12-01', status: 'active' };
const task = (id: string, title: string, completed: boolean, stage = 'days_31_60', step = 'first_two_weeks', group: string | null = null) => ({
  id, title, description: '', stage, dueDate: '2026-12-15', completed, source: 'template', step, group, goalId: null,
});
const PLAN = { id: 'p1', workplaceId: 'w1', startDate: '2026-12-01', createdAt: '2026-11-14T10:00:00.000Z', status: 'active', closedAt: null,
  tasks: [{ ...task('t1', 'Доступы к почте', false), category: 'people' }] };
const t1 = task('t1', 'Доступы к почте', false, 'days_1_30', 'first_two_weeks', 'Доступы');
const stepView = (id: string, tasks: unknown[] = []) => ({ id, groups: tasks.length ? [{ name: 'Доступы', tasks }] : [], tasksTotal: tasks.length, tasksDone: 0, status: 'active' });
const VIEW = {
  workplaceId: 'w1', hasPlan: true, startDate: '2026-12-01', dayNumber: 34,
  stages: [{ stage: 'days_1_30', title: 'познакомиться с командой', goalId: null, tasks: [t1], tasksTotal: 1, tasksDone: 0, status: 'active' }],
  steps: ['before_start', 'first_two_weeks', 'first_meeting', 'people_map', 'day_30_check', 'settling'].map((id) => stepView(id, id === 'first_two_weeks' ? [t1] : [])),
  probation: { endsOn: null, reviewer: null }, firstMeeting: null, relocated: null,
};
const PEOPLE = { workplaceId: 'w1', total: 2, withoutMeeting: 1, nextMeeting: null, groups: [
  { name: 'Команда', headcount: 2, people: [
    { id: 'p1', name: 'Илья', role: 'ведущий разработчик', group: 'Команда', cadence: 'biweekly', headcount: 1, lastMetOn: '2026-12-30', meeting: null, createdAt: '', status: 'met' },
    { id: 'p2', name: '', role: 'тестировщик', group: 'Команда', cadence: 'on_demand', headcount: 1, lastMetOn: null, meeting: null, createdAt: '', status: 'none' },
  ] },
] };

let view: Mounted | null = null;
async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}
async function open(element: ReactElement) {
  const value = { session, path: '/app/diary/adaptation', search: '', match: null, consultantRoute: null, navigate: vi.fn(), signOut: async () => undefined, theme: 'light' as const, setTheme: () => undefined };
  view = mount(<ShellProvider value={value}>{element}</ShellProvider>);
  await settle();
  await settle();
  return view.container;
}
const button = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  api.getOverview.mockResolvedValue({ primaryWorkplace: WORKPLACE });
  api.getWorkplace.mockResolvedValue({ ...WORKPLACE, planning: { adaptationPlan: PLAN } });
  api.getAdaptation.mockResolvedValue(VIEW);
  api.getPeople.mockResolvedValue(PEOPLE);
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

const CHECK = {
  workplaceId: 'w1', dueOn: '2026-12-30', sentOn: null,
  facts: [{ area: 'team', label: 'Команда', value: 'Встречи с 1 из 2 человек' }],
  signal: { area: 'team', text: 'Без встречи — 1 человек' },
  letter: '30 минут на этой неделе? Как вы оцениваете мой старт?',
};

describe('d01e проверка на 30-й день', () => {
  it('факты и сигнал; «Попросить встречу» копирует письмо, отметка «отправили» ставится и отменяется', async () => {
    checks.getDay30.mockResolvedValue(CHECK);
    checks.markDay30Sent.mockResolvedValue({ ...CHECK, sentOn: '2026-12-31' });
    checks.unmarkDay30Sent.mockResolvedValue(CHECK);
    const page = await open(<Day30Screen node={nodeByCode('d01e')!} />);
    expect(page.querySelector('#d30-title')?.textContent).toBe('Проверка на 30‑й день: один сигнал');
    expect(page.textContent).toContain('Встречи с 1 из 2 человек');
    click(button(page, 'Попросить встречу'));
    await settle();
    expect(writeText).toHaveBeenCalledWith(CHECK.letter);
    click(button(page, 'Отметить, что отправили'));
    await settle();
    expect(checks.markDay30Sent).toHaveBeenCalledWith('w1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u));
    expect(page.textContent).toContain('Письмо отправлено 31 декабря');
    click(button(page, 'Отменить'));
    await settle();
    expect(checks.unmarkDay30Sent).toHaveBeenCalledWith('w1');
    expect(page.textContent).not.toContain('Письмо отправлено');
  });

  it('ошибка отметки — на месте, с «Повторить»; ошибка загрузки — «Повторить»', async () => {
    checks.getDay30.mockResolvedValue(CHECK);
    checks.markDay30Sent.mockRejectedValue(new Error('net'));
    const page = await open(<Day30Screen node={nodeByCode('d01e')!} />);
    click(button(page, 'Попросить встречу'));
    await settle();
    click(button(page, 'Отметить, что отправили'));
    await settle();
    expect(page.textContent).toContain('Отметка не сохранилась');
    view?.unmount();
    checks.getDay30.mockRejectedValue(new Error('net'));
    const broken = await open(<Day30Screen node={nodeByCode('d01e')!} />);
    expect(broken.textContent).toContain('Проверка не загрузилась');
    expect(button(broken, 'Повторить')).not.toBeNull();
  });
});

describe('d04 итоги 90 дней', () => {
  it('цели со статусами, тексты для резюме и разговора копируются; кнопки «в профиль» нет', async () => {
    checks.getResults90.mockResolvedValue({
      workplaceId: 'w1', periodFrom: '2026-12-01', periodTo: '2027-02-28',
      items: [
        { goalId: 'g1', title: 'Срок релиза', line: 'с 14 до 5 дней', status: 'done' },
        { goalId: 'g2', title: 'Инциденты', line: 'с 6 до 3 в месяц, цель — 2', status: 'behind' },
      ],
      resumeText: 'Руководитель разработки: за первые 90 дней — срок релиза.',
      talkText: 'За 90 дней 1 из 2 целей достигнуто, 1 в работе.',
    });
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    expect(page.querySelector('#rs-title')?.textContent).toBe('Итоги 90 дней');
    expect(page.textContent).toContain('отстаёт');
    expect(page.textContent).not.toContain('Добавить в профиль');
    const copies = [...page.querySelectorAll('button')].filter((item) => item.textContent?.includes('Скопировать'));
    expect(copies).toHaveLength(2);
    click(copies[0]!);
    await settle();
    expect(writeText).toHaveBeenCalledWith('Руководитель разработки: за первые 90 дней — срок релиза.');
    expect(page.textContent).toContain('Скопировано');
  });

  it('без целей — строка пустого состояния и одно действие «Задать цели», без пустых заголовков текстов', async () => {
    checks.getResults90.mockResolvedValue({ workplaceId: 'w1', periodFrom: '2026-12-01', periodTo: '2027-02-28', items: [], resumeText: null, talkText: null });
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    expect(page.textContent).toContain('Целей с замерами за 90 дней нет');
    const action = [...page.querySelectorAll('a')].find((item) => item.textContent === 'Задать цели');
    expect(action?.getAttribute('href')).toBe('/app/diary/goals');
    expect(action?.className).toContain('is-primary');
    expect(page.textContent).not.toContain('Для резюме');
    expect(page.textContent).not.toContain('Для разговора об итоговой оценке');
    expect(page.textContent).toContain('Цели на год вперёд');
  });
});
