// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { MeetingScreen } from './MeetingScreen';
import { PeopleScreen } from './PeopleScreen';
import { PlanScreen } from './PlanScreen';
import { StepScreen } from './StepScreen';

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
function typeInto(field: Element | null, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, value);
    field?.dispatchEvent(new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
const button = (root: ParentNode, text: string) => [...root.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  api.getOverview.mockResolvedValue({ primaryWorkplace: WORKPLACE });
  api.getWorkplace.mockResolvedValue({ ...WORKPLACE, planning: { adaptationPlan: PLAN } });
  api.getAdaptation.mockResolvedValue(VIEW);
  api.getPeople.mockResolvedValue(PEOPLE);
});
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

describe('d01 план адаптации', () => {
  it('день из 90, этап с задачей, шаги без «Проверки на 30-й день»; отметка задачи сохраняет план', async () => {
    api.savePlan.mockResolvedValue({ ...WORKPLACE, planning: { adaptationPlan: PLAN } });
    const page = await open(<PlanScreen node={nodeByCode('d01')!} />);
    expect(page.querySelector('#pl-title')?.textContent).toBe('День 34 из 90: цель — познакомиться с командой');
    expect(page.textContent).toContain('2 человека · 1 без встречи');
    expect(page.textContent).not.toContain('Проверка на 30-й день');
    click(page.querySelector('[aria-label="Готово: Доступы к почте"]'));
    await settle();
    expect(api.savePlan).toHaveBeenCalledWith('w1', expect.objectContaining({ tasks: [expect.objectContaining({ id: 't1', completed: true })] }));
  });

  it('нет места работы — форма старта с ошибками полей, затем место и план', async () => {
    api.getOverview.mockResolvedValue({ primaryWorkplace: null });
    api.createWorkplace.mockResolvedValue({ ...WORKPLACE, planning: null });
    api.savePlan.mockResolvedValue({});
    const page = await open(<PlanScreen node={nodeByCode('d01')!} />);
    click(button(page, 'Начать план'));
    await settle();
    expect([...page.querySelectorAll('.va-err')].map((item) => item.textContent)).toEqual(['Укажите компанию', 'Укажите должность', 'Укажите день выхода']);
    typeInto(page.querySelector('#ap-company'), 'Вектор Банк');
    typeInto(page.querySelector('#ap-title'), 'руководитель разработки');
    typeInto(page.querySelector('#ap-start-date'), '2026-12-01');
    click(button(page, 'Начать план'));
    await settle();
    expect(api.createWorkplace).toHaveBeenCalledWith({ company: 'Вектор Банк', title: 'руководитель разработки', startDate: '2026-12-01' });
    expect(api.savePlan).toHaveBeenCalledWith('w1', expect.objectContaining({ status: 'active', tasks: expect.any(Array) }));
  });
});

describe('шаги, встреча и карта людей', () => {
  it('d01b: задачи по группам флажками', async () => {
    api.savePlan.mockRejectedValue(new Error('down'));
    const page = await open(<StepScreen node={nodeByCode('d01b')!} />);
    expect(page.querySelector('.dn-fs h3')?.textContent).toBe('Доступы');
    click(page.querySelector('#at-t1'));
    await settle();
    expect(page.textContent).toContain('Отметка не сохранилась');
  });

  it('d01c: итоги первой встречи сохраняются в план', async () => {
    api.patchAdaptation.mockResolvedValue({ ...VIEW, firstMeeting: { heldOn: '2026-12-02', expectations: 'Релизы предсказуемые', successByDay90: '', measures: '', cadence: '', needsApproval: '', ownDecisions: '', manager: '' } });
    const page = await open(<MeetingScreen node={nodeByCode('d01c')!} />);
    typeInto(page.querySelector('#mt-day'), '2026-12-02');
    typeInto(page.querySelector('#mt-expectations'), 'Релизы предсказуемые');
    click(button(page, 'Сохранить итоги'));
    await settle();
    expect(api.patchAdaptation).toHaveBeenCalledWith('w1', { firstMeeting: expect.objectContaining({ heldOn: '2026-12-02', expectations: 'Релизы предсказуемые' }) });
    expect(page.querySelector('.fact .v')?.textContent).toBe('Релизы предсказуемые');
  });

  it('d01d: люди по группам, «без встречи», назначение встречи', async () => {
    api.scheduleMeeting.mockResolvedValue({ ...PEOPLE, withoutMeeting: 0 });
    const page = await open(<PeopleScreen node={nodeByCode('d01d')!} />);
    expect(page.querySelector('.lead-sub')?.textContent).toBe('2 человека · 1 без встречи');
    expect(page.querySelectorAll('.tag')).toHaveLength(1);
    click(button(page, 'Назначить встречу'));
    const dialog = document.querySelector('[role="dialog"]')!;
    typeInto(dialog.querySelector('#mt-person'), 'p2');
    typeInto(dialog.querySelector('#mt-date'), '2027-01-08');
    click(button(dialog, 'Назначить'));
    await settle();
    expect(api.scheduleMeeting).toHaveBeenCalledWith('w1', 'p2', '2027-01-08');
    expect(page.querySelector('.lead-sub')?.textContent).toBe('2 человека · 0 без встречи');
  });
});
