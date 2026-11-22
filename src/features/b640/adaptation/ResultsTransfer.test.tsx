// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { ResultsScreen } from './ResultsScreen';

const adaptation = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getWorkplace: vi.fn(),
  getAdaptation: vi.fn(),
  getPeople: vi.fn(),
}));
vi.mock('./adaptationApi', () => adaptation);
const checks = vi.hoisted(() => ({ getResults90: vi.fn() }));
vi.mock('./checkpointsApi', () => checks);
const diary = vi.hoisted(() => ({
  listGoalCards: vi.fn(),
  getOverview: vi.fn(),
  transferGoal: vi.fn(),
}));
vi.mock('../diary/diaryApi', () => diary);
const resume = vi.hoisted(() => ({ getResumeStudio: vi.fn() }));
vi.mock('../../resume/resumeApi', () => resume);

const session = {
  username: 'f.test',
  role: 'candidate',
  isTest: true,
  candidateId: 'c',
  features: { cabinetB640: true },
  emailVerified: true,
} as AuthUser;
const WORKPLACE = {
  id: 'w1',
  company: 'Вектор Банк',
  title: 'руководитель разработки',
  startDate: '2026-12-01',
  status: 'active',
};
const EXPERIENCE = [
  { id: 'e1', title: 'Руководитель разработки', employer: 'Вектор Банк', current: true },
  { id: 'e2', title: 'Тимлид', employer: 'Лаб', current: false, endDate: '2025-12' },
];
const PLAN = {
  id: 'p1',
  workplaceId: 'w1',
  startDate: '2026-12-01',
  createdAt: '2026-11-14T10:00:00.000Z',
  status: 'active',
  closedAt: null,
  tasks: [],
};
const VIEW = {
  workplaceId: 'w1',
  hasPlan: true,
  startDate: '2026-12-01',
  dayNumber: 34,
  stages: [],
  steps: [],
  probation: { endsOn: null, reviewer: null },
  firstMeeting: null,
  relocated: null,
};
const RESULTS = {
  workplaceId: 'w1',
  periodFrom: '2026-12-01',
  periodTo: '2027-02-28',
  items: [
    { goalId: 'g1', title: 'Срок релиза', line: 'с 14 до 5 дней', status: 'done' },
    { goalId: 'g2', title: 'Нанять 2 разработчиков', line: 'с 0 до 2 чел.', status: 'done' },
    { goalId: 'g3', title: 'Инциденты', line: 'с 6 до 3 в месяц', status: 'behind' },
  ],
  resumeText: null,
  talkText: null,
};

const card = (id: string, title: string, unit: string, from: number, to: number, extra = {}) => ({
  id,
  title,
  unit: '',
  baselineValue: null,
  targetValue: 0,
  risk: { status: 'achieved', rule: 'target_reached', explanation: '' },
  details: { setBy: 'manager', agreedOn: null, weight: null, archive: null, transfer: null },
  indicators: [
    {
      id: `${id}-i`,
      title,
      unit,
      baselineValue: from,
      targetValue: to,
      latestMeasurement: { id: 'm', goalId: `${id}-i`, value: to, measuredAt: '2027-01-10' },
    },
  ],
  ...extra,
});
const RELEASE = card('g1', 'Срок релиза', 'дней', 14, 5);
const HIRING = card('g2', 'Нанять 2 разработчиков', 'чел.', 0, 2);
const MONEY = card('g1', 'Сократить затраты на 30 %', '%', 50, 20);
const moved = (source: ReturnType<typeof card>) => ({
  ...source,
  details: {
    ...source.details,
    transfer: { experienceId: 'e1', memoryId: 'm', transferredAt: '2027-03-01T09:00:00.000Z' },
  },
});

let view: Mounted | null = null;
async function settle() {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}
async function open(element: ReactElement) {
  const value = {
    session,
    path: '/app/diary/results',
    search: '',
    match: null,
    consultantRoute: null,
    navigate: vi.fn(),
    signOut: async () => undefined,
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(<ShellProvider value={value}>{element}</ShellProvider>);
  for (let step = 0; step < 4; step += 1) await settle();
  return view.container;
}
const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) ?? null;
const dialog = () => document.querySelector('.pf-dialog[role=dialog]') as HTMLElement;

function edit(element: Element | null, value: string): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  act(() => {
    setter?.call(element, value);
    element?.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  adaptation.getOverview.mockResolvedValue({ primaryWorkplace: WORKPLACE });
  adaptation.getWorkplace.mockResolvedValue({ ...WORKPLACE, planning: { adaptationPlan: PLAN } });
  adaptation.getAdaptation.mockResolvedValue(VIEW);
  adaptation.getPeople.mockResolvedValue({ nextMeeting: null, groups: [] });
  checks.getResults90.mockResolvedValue(RESULTS);
  diary.listGoalCards.mockResolvedValue({ items: [RELEASE, HIRING], archived: [] });
  diary.getOverview.mockResolvedValue({ primaryWorkplace: { id: 'w1', sourceExperienceId: 'e1' } });
  resume.getResumeStudio.mockResolvedValue({ draft: { experience: EXPERIENCE } });
  diary.transferGoal.mockImplementation(async (id: string) =>
    moved(id === 'g1' ? RELEASE : HIRING),
  );
});
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

describe('d04 «Добавить в профиль»', () => {
  it('кнопка и общая галочка стоят над строками; галочка включена', async () => {
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    const lead = page.querySelector('.lead') as HTMLElement;
    const kids = [...lead.children].map((child) => child.className || child.tagName);
    expect(kids.slice(0, 6)).toEqual([
      'lead-title is-long',
      'lead-sub',
      'actions m-commit',
      'check dn-all',
      'rows exp-rows',
    ]);
    expect(button(lead, 'Добавить в профиль')).not.toBeNull();
    const all = page.querySelector('#rs-all') as HTMLInputElement;
    expect(all.checked).toBe(true);
    expect(page.querySelector('.dn-all .tip-bubble')?.textContent).toContain(
      'проверяются на внутренние данные работодателя',
    );
  });

  it('нет достигнутых целей — ни кнопки, ни галочки', async () => {
    diary.listGoalCards.mockResolvedValue({ items: [], archived: [] });
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    expect(button(page, 'Добавить в профиль')).toBeNull();
    expect(page.querySelector('#rs-all')).toBeNull();
  });

  it('галочка включена — все достигнутые отмечены, строки без цифр работодателя, место — текущее', async () => {
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    click(button(page, 'Добавить в профиль'));
    await settle();
    const box = dialog();
    expect(box.querySelector('h2')?.textContent).toBe('Строка в профиль');
    const checked = [...box.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].map(
      (item) => item.checked,
    );
    expect(checked).toEqual([true, true]);
    const lines = [...box.querySelectorAll('textarea')].map((item) => item.value);
    expect(lines).toEqual(['Срок релиза: с 14 до 5 дней', 'Нанять 2 разработчиков: с 0 до 2 чел.']);
    expect((box.querySelector('select') as HTMLSelectElement).value).toBe('e1');
  });

  it('галочка снята — в окне ничего не отмечено, без выбора «Добавить» не нажимается', async () => {
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    click(page.querySelector('#rs-all'));
    click(button(page, 'Добавить в профиль'));
    await settle();
    const box = dialog();
    const boxes = [...box.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.map((item) => item.checked)).toEqual([false, false]);
    const add = button(box, 'Добавить в профиль') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    click(boxes[1]!);
    expect(add.disabled).toBe(false);
    click(add);
    await settle();
    expect(diary.transferGoal).toHaveBeenCalledTimes(1);
    expect(diary.transferGoal).toHaveBeenCalledWith('g2', {
      experienceId: 'e1',
      line: 'Нанять 2 разработчиков: с 0 до 2 чел.',
    });
  });

  it('строка правится до отправки; после добавления — «Перенесено», кнопка не нажимается', async () => {
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    click(button(page, 'Добавить в профиль'));
    await settle();
    edit(dialog().querySelector('textarea'), 'Сократил срок релиза вдвое');
    click(button(dialog(), 'Добавить в профиль'));
    await settle();
    expect(diary.transferGoal).toHaveBeenNthCalledWith(1, 'g1', {
      experienceId: 'e1',
      line: 'Сократил срок релиза вдвое',
    });
    expect(diary.transferGoal).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    const tags = [...page.querySelectorAll('.row .tag.ok')].map((item) => item.textContent);
    expect(tags).toEqual(['Перенесено', 'Перенесено']);
    expect((button(page, 'Добавить в профиль') as HTMLButtonElement).disabled).toBe(true);
    expect(page.querySelector('#rs-all')).toBeNull();
  });

  it('уже перенесённая цель не предлагается и не уходит повторно', async () => {
    diary.listGoalCards.mockResolvedValue({ items: [moved(RELEASE), HIRING], archived: [] });
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    expect([...page.querySelectorAll('.row .tag.ok')]).toHaveLength(1);
    click(button(page, 'Добавить в профиль'));
    await settle();
    expect(dialog().querySelectorAll('textarea')).toHaveLength(1);
    click(button(dialog(), 'Добавить в профиль'));
    await settle();
    expect(diary.transferGoal.mock.calls.map((call) => call[0])).toEqual(['g2']);
  });

  it('цифры работодателя в строке по умолчанию убраны; ответ 422 — под этой строкой, окно остаётся', async () => {
    diary.listGoalCards.mockResolvedValue({ items: [MONEY], archived: [] });
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    click(button(page, 'Добавить в профиль'));
    await settle();
    const area = dialog().querySelector('textarea') as HTMLTextAreaElement;
    expect(area.value).not.toMatch(/%/u);
    edit(area, 'Сократил затраты на 30 %');
    diary.transferGoal.mockRejectedValue(
      new CoachApiError(
        'Уберите из строки внутренние цифры работодателя.',
        'employer_figures',
        false,
      ),
    );
    click(button(dialog(), 'Добавить в профиль'));
    await settle();
    expect(dialog().querySelector('.field .re-line.is-err')?.textContent).toContain(
      'Уберите из строки внутренние цифры работодателя.',
    );
    expect(page.querySelectorAll('.row .tag.ok')).toHaveLength(0);
  });

  it('текущего места нет — выбор из «Опыта»; мест нет — «Открыть профиль»', async () => {
    resume.getResumeStudio.mockResolvedValue({
      draft: { experience: EXPERIENCE.map((item) => ({ ...item, current: false })) },
    });
    diary.getOverview.mockResolvedValue({ primaryWorkplace: null });
    const page = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    click(button(page, 'Добавить в профиль'));
    await settle();
    const select = dialog().querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('');
    click(button(dialog(), 'Добавить в профиль'));
    await settle();
    expect(diary.transferGoal).not.toHaveBeenCalled();
    expect(dialog().textContent).toContain('Выберите место работы');
    view?.unmount();
    document.body.innerHTML = '';

    resume.getResumeStudio.mockResolvedValue({ draft: { experience: [] } });
    const empty = await open(<ResultsScreen node={nodeByCode('d04')!} />);
    click(button(empty, 'Добавить в профиль'));
    await settle();
    expect(dialog().textContent).toContain('В профиле нет мест работы');
    expect(dialog().querySelector('a.btn')?.getAttribute('href')).toBe('/app/profile');
    expect(dialog().querySelector('select')).toBeNull();
  });
});
