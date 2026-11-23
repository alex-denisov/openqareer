// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { nodeByCode } from '../routes';
import { ShellProvider } from '../shell/ShellContext';
import { GoalFormScreen } from './GoalFormScreen';
import { GoalsScreen } from './GoalsScreen';

const api = vi.hoisted(() => ({
  listGoalCards: vi.fn(),
  createGoalCard: vi.fn(),
  patchGoal: vi.fn(),
  patchGoalDetails: vi.fn(),
  getOverview: vi.fn(),
}));
vi.mock('./diaryApi', () => api);
const hints = vi.hoisted(() => ({ getGoalExamples: vi.fn(), getGoalBaseline: vi.fn() }));
vi.mock('./goalHintsApi', () => hints);
const resume = vi.hoisted(() => ({ getResumeStudio: vi.fn() }));
vi.mock('../../resume/resumeApi', () => resume);
vi.mock('../kit/Toast', () => ({ useToast: () => ({ show: vi.fn(), hide: vi.fn() }) }));

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

let view: Mounted | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

async function open(element: ReactElement): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/diary/goals',
    search: '',
    match: null,
    consultantRoute: null,
    navigate: vi.fn(),
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

async function leave(input: Element | null): Promise<void> {
  act(() => {
    input?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await settle();
}

const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent === text) ?? null;
const now = (page: HTMLElement) => page.querySelector<HTMLInputElement>('#gb-0-now')!;

beforeEach(() => {
  vi.clearAllMocks();
  api.listGoalCards.mockResolvedValue({ items: [], archived: [] });
  api.getOverview.mockResolvedValue({
    primaryWorkplace: { id: 'w1', company: 'Вектор', title: 'Коммерческий директор' },
  });
  resume.getResumeStudio.mockResolvedValue({ projection: { master: null } });
  hints.getGoalExamples.mockResolvedValue(null);
  hints.getGoalBaseline.mockResolvedValue(null);
});

afterEach(() => {
  view?.unmount();
  view = null;
});

describe('B744 · d02c: примеры целей под роль', () => {
  it('примеры под роль кандидата с подписью роли', async () => {
    hints.getGoalExamples.mockResolvedValue([
      { title: 'Выполнить план выручки отдела', measure: 'от плана квартала' },
      { title: 'Снизить отток клиентов', measure: 'доля ушедших клиентов' },
      { title: 'Собрать команду продаж', measure: 'закрыто по плану найма' },
    ]);
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(hints.getGoalExamples).toHaveBeenCalledWith('Коммерческий директор');
    expect(page.querySelector('.ghost-cap')?.textContent).toBe(
      'Пример для роли «Коммерческий директор»',
    );
    expect([...page.querySelectorAll('.gc-ex strong')].map((item) => item.textContent)).toEqual([
      'Выполнить план выручки отдела',
      'Снизить отток клиентов',
      'Собрать команду продаж',
    ]);
  });

  it('примеров под роль нет — общие, подпись «Пример»; без роли модель не спрашиваем', async () => {
    const page = await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(page.querySelector('.ghost-cap')?.textContent).toBe('Пример');
    expect(page.querySelectorAll('.gc-ex')).toHaveLength(3);
    view?.unmount();
    hints.getGoalExamples.mockClear();
    api.getOverview.mockResolvedValue({ primaryWorkplace: null });
    await open(<GoalsScreen node={nodeByCode('d02')!} />);
    expect(hints.getGoalExamples).not.toHaveBeenCalled();
  });
});

const FOUND = { value: 18, quote: 'ревью ждут по полтора-два дня', entryDate: '2026-12-30' };

describe('B744 · d02b: «Сейчас» из записей', () => {
  it('показатель вписан, «Сейчас» пусто — черновик 18 с цитатой; «Верно» оставляет значение', async () => {
    hints.getGoalBaseline.mockResolvedValue(FOUND);
    const page = await open(<GoalFormScreen node={nodeByCode('d02b')!} />);
    typeInto(page.querySelector('#gb-0-i'), 'Время до первого ревью, часов');
    await leave(page.querySelector('#gb-0-i'));
    expect(hints.getGoalBaseline).toHaveBeenCalledWith('Время до первого ревью, часов');
    expect(now(page).value).toBe('18');
    expect(now(page).className).toBe('num is-draft');
    expect(now(page).getAttribute('aria-describedby')).toBe('gb-0-sg');
    expect(page.querySelector('.gb-sugg-t')?.textContent).toBe('18 — из ваших записей');
    const tip = page.querySelector('.gb-sugg [aria-label="Откуда 18"]');
    expect(tip).not.toBeNull();
    expect(page.querySelector('.gb-sugg')?.textContent).toContain(
      'Из записи 30 декабря: «ревью ждут по полтора-два дня».',
    );
    click(button(page, 'Верно'));
    expect(now(page).value).toBe('18');
    expect(now(page).className).toBe('num');
    expect(page.querySelector('.gb-sugg')).toBeNull();
  });

  it('«Нет» убирает значение; тот же показатель второй раз не спрашиваем', async () => {
    hints.getGoalBaseline.mockResolvedValue(FOUND);
    const page = await open(<GoalFormScreen node={nodeByCode('d02b')!} />);
    typeInto(page.querySelector('#gb-0-i'), 'Время до первого ревью, часов');
    await leave(page.querySelector('#gb-0-i'));
    click(button(page, 'Нет'));
    expect(now(page).value).toBe('');
    expect(page.querySelector('.gb-sugg')).toBeNull();
    await leave(page.querySelector('#gb-0-i'));
    expect(hints.getGoalBaseline).toHaveBeenCalledTimes(1);
  });

  it('своё значение «Сейчас» — не спрашиваем; правка черновика снимает подсказку', async () => {
    const page = await open(<GoalFormScreen node={nodeByCode('d02b')!} />);
    typeInto(page.querySelector('#gb-0-i'), 'Выручка, млн');
    typeInto(page.querySelector('#gb-0-now'), '40');
    await leave(page.querySelector('#gb-0-i'));
    expect(hints.getGoalBaseline).not.toHaveBeenCalled();
    hints.getGoalBaseline.mockResolvedValue(FOUND);
    typeInto(page.querySelector('#gb-0-now'), '');
    typeInto(page.querySelector('#gb-0-i'), 'Время до первого ревью, часов');
    await leave(page.querySelector('#gb-0-i'));
    typeInto(page.querySelector('#gb-0-now'), '20');
    expect(now(page).className).toBe('num');
    expect(page.querySelector('.gb-sugg')).toBeNull();
  });
});
