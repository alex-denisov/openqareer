// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, mount, type Mounted } from '../kit/testDom';
import { GoalTasks } from './GoalTasks';

const api = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getWorkplace: vi.fn(),
  getAdaptation: vi.fn(),
  patchAdaptation: vi.fn(),
  savePlan: vi.fn(),
}));
vi.mock('../adaptation/adaptationApi', () => api);

const task = (id: string, goalId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Задача ${id}`,
  description: '',
  stage: 'days_1_30',
  category: 'delivery',
  dueDate: '2027-01-14',
  completed: false,
  source: 'candidate',
  step: null,
  group: null,
  goalId,
  ...extra,
});

const plan = {
  id: 'p1',
  workplaceId: 'w1',
  startDate: '2026-12-15',
  createdAt: '2026-12-15T12:00:00.000Z',
  status: 'active',
  closedAt: null,
  tasks: [task('t1', 'g1'), task('t2', null), task('t3', 'g1', { completed: true })],
};
const workplace = (tasks = plan.tasks) => ({
  id: 'w1',
  company: 'Вектор Банк',
  title: 'Руководитель разработки',
  startDate: '2026-12-15',
  planning: { adaptationPlan: { ...plan, tasks } },
});
const viewOf = (tasks: ReturnType<typeof task>[]) => ({
  workplaceId: 'w1',
  startDate: '2026-12-15',
  stages: [{ stage: 'days_1_30', tasks }],
});

let view: Mounted | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function open(): Promise<HTMLElement> {
  view = mount(
    <div className="b640">
      <GoalTasks goalId="g1" />
    </div>,
  );
  await settle();
  await settle();
  return view.container;
}

function typeInto(input: Element | null, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  api.getOverview.mockResolvedValue({ primaryWorkplace: { id: 'w1' } });
  api.getWorkplace.mockResolvedValue(workplace());
  api.getAdaptation.mockResolvedValue(viewOf(plan.tasks));
});
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

describe('B743: d02a «Задачи»', () => {
  it('задачи этой цели с отметкой и сроком; отметка пишет план', async () => {
    const page = await open();
    expect(page.querySelector('#ga-k')?.textContent).toBe('Задачи');
    const rows = [...page.querySelectorAll('.gt-row')];
    expect(rows.map((row) => row.querySelector('label')?.textContent)).toEqual([
      'Задача t1',
      'Задача t3',
    ]);
    expect(rows[0]!.querySelector('.gt-when')?.textContent).toBe('до 14 янв');
    expect((rows[1]!.querySelector('input') as HTMLInputElement).checked).toBe(true);

    const done = plan.tasks.map((item) => (item.id === 't1' ? { ...item, completed: true } : item));
    api.savePlan.mockResolvedValue(workplace(done));
    api.getAdaptation.mockResolvedValue(viewOf(done));
    click(rows[0]!.querySelector('input'));
    await settle();
    const saved = api.savePlan.mock.calls[0]![1] as typeof plan;
    expect(saved.tasks.find((item) => item.id === 't1')?.completed).toBe(true);
    expect(saved.tasks.find((item) => item.id === 't2')?.completed).toBe(false);
    expect((page.querySelector('#gt-t1') as HTMLInputElement).checked).toBe(true);
  });

  it('«+ Задача»: задача в плане и привязка к цели', async () => {
    const page = await open();
    const added = { ...task('new', null), title: 'Созвон с отделом найма', dueDate: '2027-01-10' };
    api.savePlan.mockImplementation(async (_id: string, next: typeof plan) =>
      workplace(next.tasks),
    );
    api.patchAdaptation.mockResolvedValue(viewOf([...plan.tasks, { ...added, goalId: 'g1' }]));
    click(button(page, 'Задача'));
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    typeInto(dialog.querySelector('#at-title'), 'Созвон с отделом найма');
    typeInto(dialog.querySelector('#at-due'), '10.01.2027');
    click(button(dialog, 'Добавить'));
    await settle();
    const saved = api.savePlan.mock.calls[0]![1] as typeof plan;
    const created = saved.tasks.at(-1)!;
    expect(created).toMatchObject({ title: 'Созвон с отделом найма', dueDate: '2027-01-10' });
    expect(api.patchAdaptation).toHaveBeenCalledWith('w1', {
      tasks: { [created.id]: { goalId: 'g1' } },
    });
    expect(page.querySelectorAll('.gt-row')).toHaveLength(3);
  });

  it('задач нет — строка и «+ Задача»; места работы нет — раздела нет', async () => {
    api.getAdaptation.mockResolvedValue(viewOf([task('t2', null)]));
    const page = await open();
    expect(page.querySelector('.vl-empty')?.textContent).toBe('Задач по цели нет.');
    expect(button(page, 'Задача')).not.toBeNull();
    view?.unmount();
    api.getOverview.mockResolvedValue({ primaryWorkplace: null });
    const none = await open();
    expect(none.querySelector('#ga-k')).toBeNull();
  });

  it('план не прочитался — ошибка на месте с «Повторить»', async () => {
    api.getAdaptation.mockRejectedValueOnce(new Error('down'));
    const page = await open();
    expect(page.textContent).toContain('Задачи не загрузились');
    click(button(page, 'Повторить'));
    await settle();
    await settle();
    expect(page.querySelectorAll('.gt-row')).toHaveLength(2);
  });
});
