// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { GoalCardScreen } from './GoalCardScreen';
import { GoalFormScreen } from './GoalFormScreen';
import { GoalsScreen } from './GoalsScreen';

const api = vi.hoisted(() => ({
  listEntries: vi.fn(),
  deleteEntry: vi.fn(),
  updateEntry: vi.fn(),
  listGoalCards: vi.fn(),
  listMeasurements: vi.fn(),
  recordMeasurement: vi.fn(),
  archiveGoal: vi.fn(),
  restoreGoal: vi.fn(),
  createGoalCard: vi.fn(),
  patchGoal: vi.fn(),
  patchGoalDetails: vi.fn(),
  getOverview: vi.fn(),
  transferGoal: vi.fn(),
}));
vi.mock('./diaryApi', () => api);
const resume = vi.hoisted(() => ({ getResumeStudio: vi.fn() }));
vi.mock('../../resume/resumeApi', () => resume);
const people = vi.hoisted(() => ({ getPeople: vi.fn() }));
vi.mock('../adaptation/adaptationApi', () => people);
const toast = vi.hoisted(() => ({ show: vi.fn(), hide: vi.fn() }));
vi.mock('../kit/Toast', () => ({ useToast: () => toast }));

const session = {
  username: 'flagged.test',
  email: 'm@mail.test',
  displayName: 'Марина',
  role: 'candidate',
  isTest: true,
  candidateId: 'candidate-1',
  features: { cabinetB640: true },
  emailVerified: true,
} as AuthUser;

const summary = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Показатель ${id}`,
  type: 'operational',
  horizon: 'quarter',
  startDate: '2026-10-01',
  dueDate: '2099-01-29',
  unit: '',
  baselineValue: 0,
  targetValue: 2,
  valueSource: 'candidate_entered',
  parentGoalId: null,
  isPrimary: false,
  createdAt: '',
  updatedAt: '',
  latestMeasurement: null,
  risk: { status: 'on_track', rule: 'linear_progress_v1', explanation: 'До срока 8 недель.' },
  ...extra,
});

const hiring = {
  ...summary('g1', {
    title: 'Закрыть 2 вакансии в команду',
    risk: { status: 'at_risk', rule: 'linear_progress_v1', explanation: 'До срока 8 недель.' },
  }),
  details: { setBy: 'manager', agreedOn: null, weight: null, archive: null },
  indicators: [
    summary('i1', {
      title: 'Закрыто вакансий',
      latestMeasurement: {
        id: 'm',
        goalId: 'i1',
        value: 0,
        measuredAt: '2099-01-01',
        note: null,
        source: 'candidate_entered',
        createdAt: '',
      },
    }),
    summary('i2', { title: 'Кандидатов в финале' }),
  ],
};
const archived = {
  ...summary('g2', { title: 'Перевести сборку на общий конвейер' }),
  details: {
    setBy: 'manager',
    agreedOn: null,
    weight: null,
    archive: { archivedAt: '2026-12-22T09:00:00.000Z', reason: 'Банк меняет платформу' },
  },
  indicators: [],
};

const EXPERIENCE = [
  { id: 'e1', title: 'Руководитель разработки', employer: 'Вектор Банк', current: true },
  { id: 'e2', title: 'Тимлид', employer: 'Лаб', current: false, endDate: '2025-12' },
];

/** Значение поля или выбора — так, как его меняет кандидат. */
function editValue(element: Element | null, value: string): void {
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

let view: Mounted | null = null;
const navigate = vi.fn();

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function open(element: ReactElement, search = ''): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/diary/goals',
    search,
    match: null,
    consultantRoute: null,
    navigate,
    signOut: async () => undefined,
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(<ShellProvider value={value}>{element}</ShellProvider>);
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
  api.getOverview.mockResolvedValue({ primaryWorkplace: null });
  resume.getResumeStudio.mockResolvedValue({ projection: { master: null } });
  api.listGoalCards.mockResolvedValue({ items: [hiring], archived: [archived] });
  api.listEntries.mockResolvedValue({ items: [], nextCursor: null, summaries: [] });
  api.listMeasurements.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  view?.unmount();
  view = null;
  document.body.innerHTML = '';
});

describe('d02 «Цели и показатели»', () => {
  it('заголовок по отстающей цели, показатели, архив с причиной', async () => {
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(page.querySelector('.lead-title')?.textContent).toBe(
      'Отстаёт «Закрыть 2 вакансии в команду»',
    );
    expect(page.querySelector('.lead .btn.is-primary')?.getAttribute('href')).toBe(
      '/app/diary/goals/g1',
    );
    expect(page.querySelector('.dn-goal .tag')?.textContent).toBe('отстаёт');
    expect(
      [...page.querySelectorAll('.dn-ind > span:first-child')].map((item) => item.textContent),
    ).toEqual(['Закрыто вакансий', 'Кандидатов в финале']);
    expect(page.querySelectorAll('.dn-ind strong')[1]?.textContent).toBe('не внесено');
    expect(page.querySelector('.eyebrow')?.textContent).toBe('Архив · 1');
    expect(page.querySelector('#kp-arch .tip-bubble')?.textContent).toMatch(
      /^Убрана в архив \d+ [а-я]+( \d{4})?\. Причина: /u,
    );
  });

  it('B742: ближайшая встреча с темой и «Подготовить встречу»; без встречи блока нет', async () => {
    api.getOverview.mockResolvedValue({ primaryWorkplace: { id: 'w1' } });
    const person = { id: 'p1', name: 'Анна', role: 'директор', headcount: 1 };
    people.getPeople.mockResolvedValue({
      nextMeeting: { personId: 'p1', date: '2099-01-14', topic: 'цели года с директором' },
      groups: [{ name: 'Руководитель', headcount: 1, people: [person] }],
    });
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(people.getPeople).toHaveBeenCalledWith('w1');
    expect(page.querySelector('#kp-meet')?.textContent).toBe(
      '14 января 2099 — цели года с директором',
    );
    const prepare = page.querySelector('#kp-meet + .actions a');
    expect(prepare?.textContent).toBe('Подготовить встречу');
    expect(prepare?.getAttribute('href')).toBe('/app/diary/adaptation/manager-meeting');

    view?.unmount();
    people.getPeople.mockResolvedValue({ nextMeeting: null, groups: [] });
    const none = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(none.querySelector('#kp-meet')).toBeNull();
  });

  it('B742: достигнутая цель — «Перенести» строкой под текущим местом работы', async () => {
    const done = { ...hiring, id: 'g3', risk: { ...hiring.risk, status: 'achieved' } };
    api.listGoalCards.mockResolvedValue({ items: [hiring, done], archived: [] });
    api.getOverview.mockResolvedValue({ primaryWorkplace: { id: 'w1', sourceExperienceId: 'e1' } });
    people.getPeople.mockResolvedValue({ nextMeeting: null, groups: [] });
    resume.getResumeStudio.mockResolvedValue({ draft: { experience: EXPERIENCE } });
    api.transferGoal.mockResolvedValue({ ...done, details: { ...done.details, transfer: {} } });
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    const flags = [...page.querySelectorAll('.dn-goal')].map(
      (goal) => goal.querySelector('.dn-flag.is-done')?.textContent ?? null,
    );
    expect(flags).toEqual([null, 'Достигнута → в Итоги и в профиль · Перенести']);
    expect(api.transferGoal).not.toHaveBeenCalled();

    click(button(page, 'Перенести'));
    await settle();
    const dialog = document.querySelector('.pf-dialog[role=dialog]') as HTMLElement;
    expect(dialog.querySelector('h2')?.textContent).toBe('Строка в профиль');
    expect((dialog.querySelector('select') as HTMLSelectElement).value).toBe('e1');
    editValue(dialog.querySelector('textarea'), 'Закрыл 2 вакансии за квартал');
    click(button(dialog, 'Добавить в профиль'));
    await settle();
    expect(api.transferGoal).toHaveBeenCalledWith('g3', {
      experienceId: 'e1',
      line: 'Закрыл 2 вакансии за квартал',
    });
    expect(page.querySelector('.dn-flag.is-done')?.textContent).toBe(
      'Достигнута → в Итоги и в профиль · Перенесено',
    );
    expect(button(page, 'Перенести')).toBeNull();
  });

  it('B742: текущего места нет — выбрать из «Опыта», без выбора не отправляется', async () => {
    const done = { ...hiring, id: 'g3', risk: { ...hiring.risk, status: 'achieved' } };
    api.listGoalCards.mockResolvedValue({ items: [done], archived: [] });
    resume.getResumeStudio.mockResolvedValue({
      draft: { experience: EXPERIENCE.map((item) => ({ ...item, current: false })) },
    });
    api.transferGoal.mockResolvedValue(done);
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    click(button(page, 'Перенести'));
    await settle();
    const dialog = document.querySelector('.pf-dialog[role=dialog]') as HTMLElement;
    const select = dialog.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Выберите место работы',
      'Руководитель разработки, Вектор Банк',
      'Тимлид, Лаб',
    ]);
    click(button(dialog, 'Добавить в профиль'));
    await settle();
    expect(api.transferGoal).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('Выберите место работы');
    editValue(select, 'e2');
    click(button(dialog, 'Добавить в профиль'));
    await settle();
    expect(api.transferGoal).toHaveBeenCalledWith(
      'g3',
      expect.objectContaining({ experienceId: 'e2' }),
    );
  });

  it('B742: в профиле нет мест работы — новое не создаём, ссылка в профиль', async () => {
    const done = { ...hiring, id: 'g3', risk: { ...hiring.risk, status: 'achieved' } };
    api.listGoalCards.mockResolvedValue({ items: [done], archived: [] });
    resume.getResumeStudio.mockResolvedValue({ draft: { experience: [] } });
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    click(button(page, 'Перенести'));
    await settle();
    const dialog = document.querySelector('.pf-dialog[role=dialog]') as HTMLElement;
    expect(dialog.textContent).toContain('В профиле нет мест работы');
    expect(dialog.querySelector('select')).toBeNull();
    expect(dialog.querySelector('a.btn')?.getAttribute('href')).toBe('/app/profile');
    expect((button(dialog, 'Добавить в профиль') as HTMLButtonElement).disabled).toBe(true);
  });

  it('B742: уже перенесена — «Перенесено» без повтора', async () => {
    const done = {
      ...hiring,
      id: 'g3',
      risk: { ...hiring.risk, status: 'achieved' },
      details: {
        ...hiring.details,
        transfer: { experienceId: 'e1', memoryId: 'm', transferredAt: '' },
      },
    };
    api.listGoalCards.mockResolvedValue({ items: [done], archived: [] });
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(page.querySelector('.dn-flag.is-done')?.textContent).toBe(
      'Достигнута → в Итоги и в профиль · Перенесено',
    );
    expect(button(page, 'Перенести')).toBeNull();
  });

  it('горизонт «Год» без целей — строка пустого состояния', async () => {
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    click(button(page, 'Год'));
    expect(page.querySelector('.dn-goal')).toBeNull();
    expect(page.querySelector('.vl-empty')?.textContent).toBe('На этот срок целей нет.');
  });

  it('целей нет — вопрос и пример (d02c)', async () => {
    api.listGoalCards.mockResolvedValue({ items: [], archived: [] });
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(page.querySelector('.gc-title')).not.toBeNull();
    expect(page.querySelector('.ghost')).not.toBeNull();
  });

  it('целей нет — роль из места работы в вопросе, примеры без релизов', async () => {
    api.listGoalCards.mockResolvedValue({ items: [], archived: [] });
    api.getOverview.mockResolvedValue({
      primaryWorkplace: { id: 'w1', company: 'Вектор Банк', title: 'Операционный директор' },
    });
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(page.querySelector('.gc-title')?.textContent).toBe(
      'Какие цели в роли «Операционный директор» в первом квартале?',
    );
    expect(page.querySelector('.ghost')?.textContent).not.toMatch(/релиз/iu);
    expect(resume.getResumeStudio).not.toHaveBeenCalled();
  });

  it('целей и места работы нет — роль из профиля', async () => {
    api.listGoalCards.mockResolvedValue({ items: [], archived: [] });
    api.getOverview.mockResolvedValue({ primaryWorkplace: null });
    resume.getResumeStudio.mockResolvedValue({ projection: { master: { targetRole: 'COO' } } });
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(page.querySelector('.gc-title')?.textContent).toBe(
      'Какие цели в роли «COO» в первом квартале?',
    );
  });

  it('роли нигде нет — общий вопрос', async () => {
    api.listGoalCards.mockResolvedValue({ items: [], archived: [] });
    api.getOverview.mockRejectedValue(new Error('down'));
    resume.getResumeStudio.mockRejectedValue(new Error('down'));
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(page.querySelector('.gc-title')?.textContent).toBe('Какие у вас цели на этот квартал?');
  });
});

describe('d02a «Цель»', () => {
  it('состояние, замер в окне, другие показатели', async () => {
    const page = await open(<GoalCardScreen node={nodeByCode('d02a')!} goalId="g1" />);
    expect(page.querySelector('.gt-h')?.textContent).toBe('Закрыть 2 вакансии в команду');
    expect(page.querySelector('.gt-num')?.textContent).toBe('0 из 2');
    expect(page.querySelector('.gt-tag [aria-label="Почему отстаёт"]')).not.toBeNull();
    expect(page.querySelector('#ga-p')?.textContent).toBe('Показатели рядом');
    api.recordMeasurement.mockResolvedValue({});
    click(button(page, 'Внести замер'));
    const dialog = document.querySelector('[role="dialog"]')!;
    typeInto(dialog.querySelector('input'), '1');
    click(button(dialog, 'Сохранить замер'));
    await settle();
    expect(api.recordMeasurement).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ value: 1, note: null }),
    );
    click(button(page, 'Кандидатов в финале'));
    expect(page.querySelector('.gt-num')?.textContent).toBe('0 из 2');
  });

  it('B684: без замеров — исходное значение и строка «старт» в истории', async () => {
    api.listMeasurements.mockResolvedValue({
      items: [
        {
          id: 'm2',
          goalId: 'i1',
          value: 1,
          measuredAt: '2026-10-20',
          note: 'финал',
          source: 'candidate_entered',
          createdAt: '',
        },
      ],
      nextCursor: null,
    });
    const page = await open(<GoalCardScreen node={nodeByCode('d02a')!} goalId="g1" />);
    expect(page.querySelector('.gt-hist-l')?.textContent).toBe('Замеры · 2');
    const cells = [...page.querySelectorAll('.gt-hist tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    );
    expect(cells[0]).toEqual(['1 октября', '0 из 2', 'старт', '']);
    expect(cells[1]?.slice(1)).toEqual(['1 из 2', 'вы', 'финал']);
  });

  it('B684: исходного значения нет и замеров нет — «не внесено»', async () => {
    api.listGoalCards.mockResolvedValue({
      items: [{ ...hiring, indicators: [summary('i3', { baselineValue: null })] }],
      archived: [],
    });
    const page = await open(<GoalCardScreen node={nodeByCode('d02a')!} goalId="g1" />);
    expect(page.querySelector('.gt-num')?.textContent).toBe('не внесено');
  });

  it('в архив с причиной', async () => {
    const page = await open(<GoalCardScreen node={nodeByCode('d02a')!} goalId="g1" />);
    api.archiveGoal.mockResolvedValue({});
    click(page.querySelector('[aria-label="Ещё действия: цель"]'));
    click(button(page, 'В архив'));
    const dialog = document.querySelector('[role="dialog"]')!;
    typeInto(dialog.querySelector('input'), 'Отменена директором');
    click([...dialog.querySelectorAll('button')].find((item) => item.textContent === 'В архив')!);
    await settle();
    expect(api.archiveGoal).toHaveBeenCalledWith('g1', 'Отменена директором');
  });

  it('нет такой цели — строка на месте', async () => {
    const page = await open(<GoalCardScreen node={nodeByCode('d02a')!} goalId="nope" />);
    expect(page.querySelector('.vl-empty')?.textContent).toContain('Такой цели нет');
  });
});

describe('d02b «Новая цель»', () => {
  it('ошибки полей на месте, затем создание и переход в карточку', async () => {
    const page = await open(<GoalFormScreen node={nodeByCode('d02b')!} />);
    click(button(page, 'Сохранить цель'));
    expect([...page.querySelectorAll('.va-err')].map((item) => item.textContent)).toEqual([
      'Назовите цель',
      'Укажите срок',
      'У показателя нужны название и цель',
    ]);
    api.createGoalCard.mockResolvedValue({ id: 'new-goal' });
    typeInto(page.querySelector('#gb-n'), 'Сократить время ревью');
    typeInto(page.querySelector('#gb-d'), '31.03.2099');
    typeInto(page.querySelector('#gb-0-i'), 'Время до ревью, часов');
    typeInto(page.querySelector('#gb-0-now'), '18');
    typeInto(page.querySelector('#gb-0-tg'), '4');
    click(button(page, 'Сохранить цель'));
    await settle();
    expect(api.createGoalCard).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Сократить время ревью',
        dueDate: '2099-03-31',
        indicators: [
          { title: 'Время до ревью, часов', unit: 'часов', baselineValue: 18, targetValue: 4 },
        ],
      }),
    );
    expect(navigate).toHaveBeenCalledWith('/app/diary/goals/new-goal');
  });

  it('правка: поля из цели, сохранение правит цель и показатели', async () => {
    const page = await open(<GoalFormScreen node={nodeByCode('d02b')!} />, '?goal=g1');
    expect((page.querySelector('#gb-n') as HTMLInputElement).value).toBe(
      'Закрыть 2 вакансии в команду',
    );
    expect(button(page, 'Показатель')).toBeNull();
    api.patchGoal.mockResolvedValue({});
    typeInto(page.querySelector('#gb-0-tg'), '3');
    click(button(page, 'Сохранить цель'));
    await settle();
    expect(api.patchGoal).toHaveBeenCalledWith('i1', {
      title: 'Закрыто вакансий',
      baselineValue: 0,
      targetValue: 3,
    });
    expect(api.patchGoalDetails).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/app/diary/goals/g1');
  });
});
