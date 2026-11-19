// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { EntriesScreen } from './EntriesScreen';
import { WeekScreen } from './WeekScreen';
import { diaryWeekStart } from '../../../../shared/careerDiaryEntries';
import { today } from './model';

const api = vi.hoisted(() => ({
  listEntries: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  deleteEntry: vi.fn(),
  getWeek: vi.fn(),
  saveWeek: vi.fn(),
  listGoalCards: vi.fn(),
  getOverview: vi.fn(),
  recordMeasurement: vi.fn(),
}));
vi.mock('./diaryApi', () => api);
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

const DAY = today();
const WEEK = diaryWeekStart(DAY)!;

const entry = (id: string, kind: string, text: string, goalId: string | null = null) => ({
  id,
  date: DAY,
  weekStart: WEEK,
  kind,
  text,
  goalId,
  createdAt: `${DAY}T10:00:00.000Z`,
  updatedAt: `${DAY}T10:00:00.000Z`,
});

const indicator = {
  id: 'ind-1',
  title: 'Срок релиза',
  unit: 'дней',
  baselineValue: 14,
  targetValue: 7,
  dueDate: '2099-03-31',
  latestMeasurement: {
    id: 'm1',
    goalId: 'ind-1',
    value: 9,
    measuredAt: '2000-01-01',
    note: null,
    source: 'candidate_entered',
    createdAt: '',
  },
};
const card = {
  id: 'goal-1',
  title: 'Выпускать релиз за неделю',
  dueDate: '2099-03-31',
  targetValue: 7,
  unit: 'дней',
  baselineValue: 14,
  latestMeasurement: null,
  indicators: [indicator],
  details: { setBy: 'manager', agreedOn: null, weight: null, archive: null },
};

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
    path: '/app/diary',
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
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listEntries.mockResolvedValue({
    items: [
      entry('e1', 'result', 'Релиз вышел за 5 дней', 'goal-1'),
      entry('e2', 'problem', 'Ждали тестовую среду'),
    ],
    nextCursor: 'c2',
    summaries: [],
  });
  api.listGoalCards.mockResolvedValue({ items: [card], archived: [] });
  api.getOverview.mockResolvedValue({ platformStartedAt: null });
});
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('d00 «Записи»', () => {
  it('лента по неделям: метки видов, цель записи, «Подвести итог» и «Ближайшее»', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    expect(page.querySelector('[data-b640-node="d00"]')).not.toBeNull();
    const tags = [...page.querySelectorAll('.dn-entry .tag')].map((tag) => tag.textContent);
    expect(tags).toEqual(['результат', 'проблема']);
    expect(page.querySelector('.dn-goal-link')?.textContent).toContain('Выпускать релиз за неделю');
    expect(page.querySelector('.dn-week-act a')?.getAttribute('href')).toBe(
      `/app/diary/week?week=${WEEK}`,
    );
    expect(page.querySelector('.dn-side-t')?.textContent).toContain('Выпускать релиз за неделю');
  });

  it('быстрая запись идёт с видом выбранного фильтра и встаёт в ленту', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    api.listEntries.mockResolvedValue({ items: [], nextCursor: null, summaries: [] });
    click(
      [...page.querySelectorAll('.dn-kinds .chip')].find((chip) => chip.textContent === 'Встреча')!,
    );
    await settle();
    expect(api.listEntries).toHaveBeenLastCalledWith({ kind: 'meeting' });
    api.createEntry.mockResolvedValue(entry('e3', 'meeting', 'Встреча с директором'));
    typeInto(page.querySelector('#dn-new'), 'Встреча с директором');
    click(page.querySelector('.dn-quick button[type="submit"]'));
    await settle();
    expect(api.createEntry).toHaveBeenCalledWith({
      date: DAY,
      kind: 'meeting',
      text: 'Встреча с директором',
    });
    expect(page.querySelector('.dn-text')?.textContent).toBe('Встреча с директором');
    expect((page.querySelector('#dn-new') as HTMLInputElement).value).toBe('');
  });

  it('сбой записи: строка с «Повторить», текст не теряется', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    api.createEntry.mockRejectedValueOnce(new Error('down'));
    typeInto(page.querySelector('#dn-new'), 'Текст');
    click(page.querySelector('.dn-quick button[type="submit"]'));
    await settle();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('Запись не сохранилась');
    expect((page.querySelector('#dn-new') as HTMLInputElement).value).toBe('Текст');
  });

  it('удаление: запись уходит, тост с «Отменить» возвращает её', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    api.deleteEntry.mockResolvedValue(undefined);
    click(page.querySelector('.dn-entry .row-act.is-danger'));
    await settle();
    expect(page.querySelectorAll('.dn-entry')).toHaveLength(1);
    const shown = toast.show.mock.calls[0][0];
    expect(shown.text).toBe('Запись удалена');
    api.createEntry.mockResolvedValue(entry('e9', 'result', 'Релиз вышел за 5 дней', 'goal-1'));
    act(() => shown.undo.onUndo());
    await settle();
    expect(api.createEntry).toHaveBeenCalledWith({
      date: DAY,
      kind: 'result',
      text: 'Релиз вышел за 5 дней',
      goalId: 'goal-1',
    });
    expect(page.querySelectorAll('.dn-entry')).toHaveLength(2);
  });

  it('правка записи на месте', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    click(page.querySelector('.dn-entry .row-act'));
    const form = page.querySelector('form.dn-edit')!;
    typeInto(form.querySelector('textarea'), 'Релиз за 4 дня');
    api.updateEntry.mockResolvedValue({ ...entry('e1', 'result', 'Релиз за 4 дня', 'goal-1') });
    click(form.querySelector('button[type="submit"]'));
    await settle();
    expect(api.updateEntry).toHaveBeenCalledWith('e1', {
      text: 'Релиз за 4 дня',
      date: DAY,
      kind: 'result',
      goalId: 'goal-1',
    });
    expect(page.querySelector('form.dn-edit')).toBeNull();
    expect(page.querySelector('.dn-text')?.textContent).toBe('Релиз за 4 дня');
  });

  it('«Показать ещё» дочитывает ленту по курсору', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    api.listEntries.mockResolvedValue({
      items: [entry('e5', 'note', 'Старая')],
      nextCursor: null,
      summaries: [],
    });
    click(page.querySelector('.vl-foot button'));
    await settle();
    expect(api.listEntries).toHaveBeenLastCalledWith({}, 'c2');
    expect(page.querySelectorAll('.dn-entry')).toHaveLength(3);
    expect(page.querySelector('.vl-foot')).toBeNull();
  });

  it('сбой ленты: строка с «Повторить»', async () => {
    api.listEntries.mockRejectedValueOnce(new Error('down'));
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('Записи не загрузились');
  });
});

describe('d00 пустой дневник (d00a, d00b)', () => {
  beforeEach(() => {
    api.listEntries.mockResolvedValue({ items: [], nextCursor: null, summaries: [] });
    api.listGoalCards.mockResolvedValue({ items: [], archived: [] });
  });

  it('без записей: лид «С чего начнём дневник?», без недель, фильтров и «Подвести итог»', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    expect(page.querySelector('.lead-title')?.textContent).toBe('С чего начнём дневник?');
    const actions = [...page.querySelectorAll('.lead .actions .btn')].map((btn) => btn.textContent);
    expect(actions).toEqual(['Начать с плана адаптации', 'Первая запись']);
    expect(page.querySelector('.lead .actions a')?.getAttribute('href')).toBe(
      '/app/diary/adaptation',
    );
    expect(page.querySelector('.dn-week')).toBeNull();
    expect(page.querySelector('.dn-kinds')).toBeNull();
    expect(page.textContent).not.toContain('Подвести итог');
    expect(page.textContent).not.toContain('Здесь появятся ваши записи.');
  });

  it('«Первая запись» ведёт в ленту с быстрой записью и курсором в ней', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    const first = [...page.querySelectorAll('.lead .actions a')].find(
      (link) => link.textContent === 'Первая запись',
    );
    expect(first?.getAttribute('href')).toBe('/app/diary?write=1');
    view?.unmount();
    const writing = await open(<EntriesScreen node={nodeByCode('d00')!} />, '?write=1');
    expect(writing.querySelector('.lead-title')).toBeNull();
    expect(document.activeElement?.id).toBe('dn-new');
  });

  it('d00a — одна колонка: без быстрой записи и правой колонки', async () => {
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    expect(page.querySelector('.page.two')).toBeNull();
    expect(page.querySelector('#dn-new')).toBeNull();
    expect(page.querySelector('.dn-side')).toBeNull();
  });

  it('день выхода: «Первый рабочий день…» и подпись «компания · роль · день 1»', async () => {
    api.getOverview.mockResolvedValue({
      platformStartedAt: null,
      primaryWorkplace: {
        id: 'w1',
        company: 'Вектор Банк',
        title: 'Операционный директор',
        startDate: DAY,
      },
    });
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    expect(page.querySelector('.lead-title')?.textContent).toBe(
      'Первый рабочий день. С чего начнём дневник?',
    );
    expect(page.querySelector('.lead-sub')?.textContent).toBe(
      'Вектор Банк · Операционный директор · день 1',
    );
  });

  it('текущая неделя без записей — без «Подвести итог»', async () => {
    const old = new Date(Date.parse(`${DAY}T00:00:00Z`) - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    api.listEntries.mockResolvedValue({
      items: [
        { ...entry('e9', 'note', 'Старая запись'), date: old, weekStart: diaryWeekStart(old) },
      ],
      nextCursor: null,
      summaries: [],
    });
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    expect(page.querySelector('.dn-entry')).not.toBeNull();
    expect(page.querySelector('.dn-week-act')).toBeNull();
    expect(page.querySelector('.lead-title')).toBeNull();
    const side = [...page.querySelectorAll('.dn-side')].map((block) => [
      block.querySelector('.dn-side-h')?.textContent,
      block.querySelector('.btn')?.textContent,
      block.querySelector('.btn')?.getAttribute('href'),
    ]);
    expect(side).toEqual([
      ['План адаптации', 'Добавить план', '/app/diary/adaptation'],
      ['Цели', 'Задать цель', '/app/diary/goals/new'],
    ]);
  });

  it('записи есть и место работы есть: справа «Адаптация · Открыть план»', async () => {
    api.getOverview.mockResolvedValue({
      platformStartedAt: null,
      primaryWorkplace: {
        id: 'w1',
        company: 'Вектор Банк',
        title: 'Операционный директор',
        startDate: DAY,
      },
    });
    api.listGoalCards.mockResolvedValue({ items: [card], archived: [] });
    api.listEntries.mockResolvedValue({
      items: [entry('e1', 'note', 'Запись')],
      nextCursor: null,
      summaries: [],
    });
    const page = await open(<EntriesScreen node={nodeByCode('d00')!} />);
    const heads = [...page.querySelectorAll('.dn-side-h')].map((head) => head.textContent);
    expect(heads).toEqual(['Ближайшее', 'Адаптация']);
    expect(page.querySelector('#dn-plan')?.parentElement?.querySelector('.btn')?.textContent).toBe(
      'Открыть план',
    );
  });
});

describe('d00d «Итог недели»', () => {
  beforeEach(() => {
    api.getWeek.mockResolvedValue({
      weekStart: WEEK,
      entries: [
        entry('e1', 'result', 'Релиз вышел за 5 дней'),
        entry('e2', 'problem', 'Ждали среду'),
      ],
      achievedEntryIds: ['e1'],
      blockers: 'Ждали среду',
      plan: [{ text: 'Разобрать, где ждёт релиз', goalId: 'goal-1', source: 'carried' }],
      saved: null,
    });
  });

  it('черновик: замеры с «было», что получилось, что мешает, план с целью', async () => {
    const page = await open(<WeekScreen node={nodeByCode('d00d')!} />, `?week=${WEEK}`);
    expect(page.querySelector('.dn-kpi-in label')?.textContent).toBe('Срок релиза, дней');
    expect(page.querySelector('.dn-kpi-in input')?.getAttribute('placeholder')).toBe('было 9');
    const achieved = [...page.querySelectorAll('.dn-fs')[1].querySelectorAll('.check label')].map(
      (label) => label.textContent,
    );
    expect(achieved).toHaveLength(1);
    expect(achieved[0]).toContain('Релиз вышел за 5 дней');
    expect((page.querySelector('#wk-bad') as HTMLTextAreaElement).value).toBe('Ждали среду');
    expect(page.querySelector('[id^="pl-"] + label')?.textContent).toContain(
      'Выпускать релиз за неделю',
    );
  });

  it('сохранение: замер, итог и возврат к записям', async () => {
    const page = await open(<WeekScreen node={nodeByCode('d00d')!} />, `?week=${WEEK}`);
    api.recordMeasurement.mockResolvedValue({});
    api.saveWeek.mockResolvedValue({});
    typeInto(page.querySelector('.dn-kpi-in input'), '5,5');
    click(page.querySelector('[aria-label="Убрать из итога"]'));
    click(
      [...page.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Сохранить итог'),
      )!,
    );
    await settle();
    expect(api.recordMeasurement).toHaveBeenCalledWith('ind-1', { value: 5.5, measuredAt: DAY });
    expect(api.saveWeek).toHaveBeenCalledWith(WEEK, {
      achievedEntryIds: [],
      achievedNotes: [],
      blockers: 'Ждали среду',
      plan: [{ text: 'Разобрать, где ждёт релиз', goalId: 'goal-1', done: false }],
    });
    expect(navigate).toHaveBeenCalledWith('/app/diary');
  });

  it('сбой сохранения: строка с «Повторить», введённое на месте', async () => {
    const page = await open(<WeekScreen node={nodeByCode('d00d')!} />);
    api.saveWeek.mockRejectedValueOnce(new Error('down'));
    typeInto(page.querySelector('#wk-bad'), 'Новое');
    click(
      [...page.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Сохранить итог'),
      )!,
    );
    await settle();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain('Итог не сохранился');
    expect((page.querySelector('#wk-bad') as HTMLTextAreaElement).value).toBe('Новое');
    expect(navigate).not.toHaveBeenCalled();
  });
});
