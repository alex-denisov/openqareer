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
  generateSteps: vi.fn(),
  patchAdaptation: vi.fn(),
  addPerson: vi.fn(),
  updatePerson: vi.fn(),
  removePerson: vi.fn(),
  scheduleMeeting: vi.fn(),
}));
vi.mock('./adaptationApi', () => api);
const responsesApi = vi.hoisted(() => ({ listApplicationsPool: vi.fn(), fetchVacancyDetail: vi.fn() }));
vi.mock('../../applications/applicationsApi', () => ({ listApplicationsPool: responsesApi.listApplicationsPool }));
vi.mock('../../vacancies/vacancyDetailApi', () => ({ fetchVacancyDetail: responsesApi.fetchVacancyDetail }));
const STEPS = [
  { title: 'Познакомиться с командой', description: 'Встречи один на один.', stage: 'days_1_30', category: 'people', basis: 'Руководить командой из 25 человек' },
  { title: 'Разобрать поставку', description: 'Где теряется время.', stage: 'days_31_60', category: 'delivery', basis: 'Выстроить поставку' },
  { title: 'Запустить еженедельный релиз', description: 'Первый релиз.', stage: 'days_61_90', category: 'delivery', basis: 'Выстроить поставку' },
];
const RESPONSES = [
  { clusterId: 'cl-bank', stage: 'applied', createdAt: '2026-11-12T09:00:00.000Z', appliedAt: '2026-11-12T09:00:00.000Z', offer: null, vacancy: { title: 'Руководитель разработки', company: 'Вектор Банк', url: '', source: 'hh' } },
  { clusterId: 'cl-tel', stage: 'applied', createdAt: '2026-11-05T09:00:00.000Z', appliedAt: '2026-11-05T09:00:00.000Z', offer: null, vacancy: { title: 'Технический директор', company: 'Вектор Телеком', url: '', source: 'hh' } },
];

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
  responsesApi.listApplicationsPool.mockResolvedValue({ items: RESPONSES, meta: { total: 2, offset: 0 } });
  responsesApi.fetchVacancyDetail.mockResolvedValue({ id: 'cl-bank', description: '', truncated: false, skills: [], responsibilities: ['Руководить командой из 25 человек', 'Выстроить поставку'] });
});
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

describe('d01 план адаптации', () => {
  it('день из 90, этап с задачей, шаги вместе с «Проверкой на 30-й день»; отметка задачи сохраняет план', async () => {
    api.savePlan.mockResolvedValue({ ...WORKPLACE, planning: { adaptationPlan: PLAN } });
    const page = await open(<PlanScreen node={nodeByCode('d01')!} />);
    expect(page.querySelector('#pl-title')?.textContent).toBe('День 34 из 90: цель — познакомиться с командой');
    expect(page.textContent).toContain('2 человека · 1 без встречи');
    expect(page.textContent).toContain('Проверка на 30-й день');
    click(page.querySelector('[aria-label="Готово: Доступы к почте"]'));
    await settle();
    expect(api.savePlan).toHaveBeenCalledWith('w1', expect.objectContaining({ tasks: [expect.objectContaining({ id: 't1', completed: true })] }));
  });

  it('d01g: нет места работы — фраза-лид, четыре поля без подсказок, ошибки на месте, затем место и план', async () => {
    api.getOverview.mockResolvedValue({ primaryWorkplace: null });
    api.createWorkplace.mockResolvedValue({ ...WORKPLACE, planning: null });
    api.savePlan.mockResolvedValue({});
    const page = await open(<PlanScreen node={nodeByCode('d01')!} />);
    const screen = page.querySelector('.page.gb-page[data-b640-node="d01"]')!;
    expect(screen.classList.contains('two')).toBe(false);
    expect(screen.querySelector('h2.lead-title.is-long')?.textContent).toBe('Чтобы собрать план, укажите, куда вы выходите');
    expect([...screen.querySelectorAll('.gb-f label')].map((item) => item.textContent)).toEqual([
      'Компания', 'Должность', 'День выхода', 'Что от вас ждут',
    ]);
    expect([...screen.querySelectorAll('.gb-f')].map((field) => field.children.length)).toEqual([2, 2, 2, 2]);
    click(button(page, 'Собрать план'));
    await settle();
    expect([...page.querySelectorAll('.va-err')].map((item) => item.textContent)).toEqual(['Укажите компанию', 'Укажите должность', 'Укажите день выхода']);
    typeInto(page.querySelector('#ap-company'), 'Норма');
    typeInto(page.querySelector('#ap-title'), 'руководитель разработки');
    typeInto(page.querySelector('#ap-start-date'), '01.12.2026');
    click(button(page, 'Собрать план'));
    await settle();
    expect(api.createWorkplace).toHaveBeenCalledWith({ company: 'Норма', title: 'руководитель разработки', startDate: '2026-12-01' });
    expect(api.savePlan).toHaveBeenCalledWith('w1', expect.objectContaining({ status: 'active', tasks: expect.any(Array) }));
    expect(api.generateSteps).not.toHaveBeenCalled();
  });

  it('d01h/d01i: компания из откликов подставляет должность и обязанности вакансии', async () => {
    api.getOverview.mockResolvedValue({ primaryWorkplace: null });
    api.createWorkplace.mockResolvedValue({ ...WORKPLACE, planning: null });
    api.savePlan.mockResolvedValue({});
    api.generateSteps.mockResolvedValue(STEPS);
    const page = await open(<PlanScreen node={nodeByCode('d01')!} />);
    const company = page.querySelector('#ap-company') as HTMLInputElement;
    expect(company.getAttribute('role')).toBe('combobox');
    expect(company.getAttribute('aria-expanded')).toBe('false');
    typeInto(company, 'Вект');
    const options = [...page.querySelectorAll('[role=listbox] [role=option]')];
    expect(company.getAttribute('aria-expanded')).toBe('true');
    expect(options.map((item) => [item.querySelector('.ac-t')?.textContent, item.querySelector('.ac-v')?.textContent])).toEqual([
      ['Вектор Банк', 'Руководитель разработки · отклик 12.11'],
      ['Вектор Телеком', 'Технический директор · отклик 05.11'],
    ]);
    act(() => {
      company.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(company.getAttribute('aria-activedescendant')).toBe(options[0].id);
    act(() => {
      company.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();
    expect(page.querySelector('[role=listbox]')).toBeNull();
    expect(company.value).toBe('Вектор Банк');
    expect((page.querySelector('#ap-title') as HTMLInputElement).value).toBe('Руководитель разработки');
    expect(responsesApi.fetchVacancyDetail).toHaveBeenCalledWith('cl-bank');
    const duties = page.querySelector('#ap-expectations') as HTMLTextAreaElement;
    expect(duties.value).toBe('Руководить командой из 25 человек\nВыстроить поставку');
    typeInto(page.querySelector('#ap-start-date'), '01.12.2026');
    click(button(page, 'Собрать план'));
    await settle();
    expect(api.createWorkplace).toHaveBeenCalledWith({
      company: 'Вектор Банк', title: 'Руководитель разработки', startDate: '2026-12-01',
      expectations: 'Руководить командой из 25 человек\nВыстроить поставку',
    });
    expect(api.generateSteps).toHaveBeenCalledWith('w1');
    const saved = api.savePlan.mock.calls.at(-1)?.[1];
    expect(saved.tasks.map((task: { title: string; stage: string }) => [task.title, task.stage])).toEqual(
      STEPS.map((step) => [step.title, step.stage]),
    );
  });

  it('d01: модель не ответила — план из шаблона, без ошибки и без следа пути', async () => {
    api.getOverview.mockResolvedValue({ primaryWorkplace: null });
    api.createWorkplace.mockResolvedValue({ ...WORKPLACE, planning: null });
    api.savePlan.mockResolvedValue({});
    api.generateSteps.mockRejectedValue(new Error('502'));
    const page = await open(<PlanScreen node={nodeByCode('d01')!} />);
    typeInto(page.querySelector('#ap-company'), 'Норма');
    typeInto(page.querySelector('#ap-title'), 'CTO');
    typeInto(page.querySelector('#ap-start-date'), '01.12.2026');
    typeInto(page.querySelector('#ap-expectations'), 'Руководить командой');
    click(button(page, 'Собрать план'));
    await settle();
    const saved = api.savePlan.mock.calls.at(-1)?.[1];
    expect(saved.tasks.length).toBeGreaterThan(STEPS.length);
    expect(saved.tasks.every((task: { source: string }) => task.source === 'template')).toBe(true);
    expect(page.querySelector('[role=alert]')).toBeNull();
  });

  it('d01h: подстановка не затирает то, что кандидат уже написал, и молчит без откликов', async () => {
    api.getOverview.mockResolvedValue({ primaryWorkplace: null });
    const page = await open(<PlanScreen node={nodeByCode('d01')!} />);
    typeInto(page.querySelector('#ap-expectations'), 'Своё описание');
    typeInto(page.querySelector('#ap-company'), 'Вект');
    click(page.querySelector('[role=option]'));
    await settle();
    expect((page.querySelector('#ap-expectations') as HTMLTextAreaElement).value).toBe('Своё описание');
    view?.unmount();
    responsesApi.listApplicationsPool.mockRejectedValue(new Error('500'));
    const again = await open(<PlanScreen node={nodeByCode('d01')!} />);
    typeInto(again.querySelector('#ap-company'), 'Вект');
    expect(again.querySelector('[role=listbox]')).toBeNull();
    expect(again.querySelector('[role=alert]')).toBeNull();
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
    typeInto(page.querySelector('#mt-day'), '02.12.2026');
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
    typeInto(dialog.querySelector('#mt-date'), '08.01.2027');
    click(button(dialog, 'Назначить'));
    await settle();
    expect(api.scheduleMeeting).toHaveBeenCalledWith('w1', 'p2', '2027-01-08');
    expect(page.querySelector('.lead-sub')?.textContent).toBe('2 человека · 0 без встречи');
  });
});
