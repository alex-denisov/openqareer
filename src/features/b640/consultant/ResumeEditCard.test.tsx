// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import type { AuthUser, CandidateMemory } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { ShellProvider } from '../shell/ShellContext';
import { editReply, ResumeEditCard } from './ResumeEditCard';

const api = vi.hoisted(() => ({
  requestFactRewrite: vi.fn(),
  requestFactReword: vi.fn(),
  applyFactRewrite: vi.fn(),
  revertFactRewrite: vi.fn(),
  listFactRewriteVariants: vi.fn(),
  createFactRewriteVariant: vi.fn(),
  getResumeStudio: vi.fn(),
  saveResumeStudioDraft: vi.fn(),
}));
vi.mock('../../resume/experienceFactRewriteApi', () => api);
vi.mock('../../resume/resumeApi', () => api);

const session = { username: 'flagged.test', role: 'candidate' } as AuthUser;
const draft = {
  experience: [{ id: 'e1', employer: 'Сфера Платежи', bulletMemoryIds: [] }],
  declinedFactIds: ['old'],
};
const NOW = 'Руководила группой бэкенда из 18 человек.';
const proposal = {
  id: 'p1',
  places: [
    {
      experienceId: 'e1',
      bullets: [
        { text: 'Другой пункт.', sourceFactIds: ['other'] },
        { text: NOW, sourceFactIds: ['m1', 'm2'] },
      ],
    },
  ],
  leftOutFactIds: [],
  sourceFactIds: ['other', 'm1', 'm2'],
};

let view: Mounted | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    for (let step = 0; step < 6; step += 1) await Promise.resolve();
  });
}

async function open(
  factId = 'm1',
  source: Parameters<typeof ResumeEditCard>[0]['source'] = { kind: 'fact', factId },
): Promise<HTMLElement> {
  const value = {
    session,
    path: '/app/responses/review',
    search: '',
    match: null,
    consultantRoute: null,
    navigate: vi.fn(),
    signOut: async () => undefined,
    theme: 'light' as const,
    setTheme: () => undefined,
  };
  view = mount(
    <ShellProvider value={value}>
      <ResumeEditCard source={source} reason="Причина" memory={[]} messages={[]} />
    </ShellProvider>,
  );
  await settle();
  return view.container;
}

function button(root: HTMLElement, name: string): HTMLElement {
  const found = [...root.querySelectorAll('button')].find(
    (item) => item.getAttribute('aria-label') === name || item.textContent === name,
  );
  if (!found) throw new Error(`нет кнопки «${name}»`);
  return found;
}

async function press(root: HTMLElement, name: string): Promise<void> {
  click(button(root, name));
  await settle();
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  api.requestFactRewrite.mockResolvedValue(proposal);
  api.applyFactRewrite.mockResolvedValue({ id: 'r1' });
  api.revertFactRewrite.mockResolvedValue(undefined);
  api.listFactRewriteVariants.mockResolvedValue({ variants: [], remaining: 3 });
  api.getResumeStudio.mockResolvedValue({ draft });
  api.saveResumeStudioDraft.mockResolvedValue(undefined);
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('o07 → k06: правка резюме у консультанта', () => {
  it('показывает пункт из названного факта и до нажатия ничего не пишет', async () => {
    const root = await open();
    expect(root.querySelector('.ec-title')?.textContent).toContain('Сфера Платежи');
    expect(root.querySelector('.ec-diff .now')?.textContent).toBe(`Станет${NOW}`);
    expect(root.textContent).not.toContain('Другой пункт');
    expect(api.applyFactRewrite).not.toHaveBeenCalled();
    expect(api.saveResumeStudioDraft).not.toHaveBeenCalled();
  });

  it('реплика называет место и запись; «из беседы» — только когда реплика кандидата найдена', () => {
    const edit = {
      proposalId: 'p1',
      key: 'e1#1',
      place: 'Сфера Платежи',
      text: NOW,
      sourceFactIds: ['m1'],
    };
    const fact = {
      id: 'm1',
      statement: 'Команда 18 человек',
      sourceMessageIds: ['u1'],
      status: 'confirmed',
    } as CandidateMemory;
    const said = { id: 'u1', role: 'user' as const, content: '', at: '2026-11-11T10:00:00.000Z' };
    expect(editReply(edit, [fact], [said])).toBe(
      'Новая строка: «Сфера Платежи». «Команда 18 человек» — из беседы 11.11, запись вы подтвердили: «Верно».',
    );
    expect(editReply(edit, [fact], [])).toBe(
      'Новая строка: «Сфера Платежи». «Команда 18 человек».',
    );
    expect(editReply(edit, [{ ...fact, sensitive: true }], [])).toBe(
      'Новая строка: «Сфера Платежи».',
    );
  });

  it('«Применить» пишет только этот пункт, «Отменить» возвращает', async () => {
    const root = await open();
    await press(root, 'Применить');
    expect(api.applyFactRewrite).toHaveBeenCalledWith('p1', {}, ['e1#1'], undefined);
    expect(root.textContent).toContain('Применено');
    await press(root, 'Отменить');
    expect(api.revertFactRewrite).toHaveBeenCalledWith('r1');
    expect(api.requestFactRewrite).toHaveBeenCalledTimes(2);
    expect(button(root, 'Применить')).toBeTruthy();
  });

  it('«Отклонить» больше не предлагает факты этого пункта', async () => {
    const root = await open();
    await press(root, 'Отклонить');
    expect(api.saveResumeStudioDraft).toHaveBeenCalledWith(
      expect.objectContaining({ declinedFactIds: ['old', 'm1', 'm2'] }),
    );
    expect(root.querySelector('.ec')).toBeNull();
  });

  it('сбой записи — «Правка не применилась», карточка на месте', async () => {
    api.applyFactRewrite.mockRejectedValue(new Error('сеть'));
    const root = await open();
    await press(root, 'Применить');
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Правка не применилась');
    expect(button(root, 'Применить')).toBeTruthy();
  });

  it('предложение устарело — консультант готовит правку заново', async () => {
    api.applyFactRewrite.mockRejectedValue(new CoachApiError('x', 'rewrite_stale', true));
    const root = await open();
    await press(root, 'Применить');
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Правка не применилась');
    await press(root, 'Повторить');
    expect(api.requestFactRewrite).toHaveBeenCalledTimes(2);
  });

  it('пункта из этого факта нет — «Открыть профиль»', async () => {
    const root = await open('missing');
    expect(root.querySelector('.ec')).toBeNull();
    expect(root.querySelector('a.btn')?.textContent).toContain('Открыть профиль');
    expect(root.querySelector('a.btn')?.getAttribute('href')).toBe('/app/profile');
  });

  it('B786: новая формулировка строки — «Было» и «Станет», «Отклонить» резюме не трогает', async () => {
    const before = 'Вела бэкенд платёжного шлюза.';
    const reword = {
      id: 'r1',
      places: [
        {
          experienceId: 'e1',
          bullets: [{ text: NOW, sourceFactIds: ['line', 'm1'], replacesMemoryId: 'line' }],
        },
      ],
      leftOutFactIds: [],
      sourceFactIds: ['line', 'm1'],
    };
    api.requestFactReword.mockResolvedValue({ proposal: reword, before });
    const root = await open('m1', { kind: 'reword', experienceId: 'e1' });
    expect(api.requestFactReword).toHaveBeenCalledWith('e1');
    expect(root.querySelector('.ec-title')?.textContent).toContain('Сфера Платежи · первая строка');
    expect(root.querySelector('.ec-diff .was dd')?.textContent).toBe(before);
    expect(root.querySelector('.ec-diff .now dd')?.textContent).toBe(NOW);
    expect(root.querySelector('.ec-was p')?.textContent).toBe(before);
    await press(root, 'Отклонить');
    expect(api.saveResumeStudioDraft).not.toHaveBeenCalled();
    expect(root.querySelector('.ec')).toBeNull();
  });

  it('правка не подготовилась — понятная строка, «Попробовать ещё раз» спрашивает снова', async () => {
    api.requestFactRewrite.mockRejectedValueOnce(new Error('503'));
    const root = await open();
    const alert = root.querySelector('[role=alert]')?.textContent ?? '';
    expect(alert).toContain('Не получилось подготовить правку');
    expect(alert).not.toContain('Ответ не пришёл');
    await press(root, 'Попробовать ещё раз');
    expect(root.textContent).toContain(NOW);
  });

  const variant = (position: number) => ({
    id: `v${position}`,
    position,
    text: `Вариант ${position} из 18 человек.`,
  });
  const shown = (root: HTMLElement) => root.querySelector('.ec-diff .now dd')?.textContent;

  it('«Другой вариант» ничего не пишет, прежние листаются, применяется показанный', async () => {
    api.createFactRewriteVariant.mockResolvedValue({ variants: [variant(1)], remaining: 2 });
    const root = await open();
    await press(root, 'Другой вариант');
    expect(root.querySelector('[role=dialog]')?.textContent).toContain('Что поменять');
    await press(root, 'Короче');
    await press(root, 'Сделать вариант');
    expect(api.createFactRewriteVariant).toHaveBeenCalledWith('p1', 'e1#1', {
      chips: ['shorter'],
      text: '',
    });
    expect(shown(root)).toBe('Вариант 1 из 18 человек.');
    expect(root.querySelector('.var-sw')?.textContent).toBe('2 из 2');
    expect(api.applyFactRewrite).not.toHaveBeenCalled();
    await press(root, 'Предыдущий вариант');
    expect(shown(root)).toBe(NOW);
    await press(root, 'Следующий вариант');
    await press(root, 'Применить');
    expect(api.applyFactRewrite).toHaveBeenCalledWith('p1', {}, ['e1#1'], 'v1');
  });

  it('варианты кончились: кнопки нет, листание и остальные действия остаются', async () => {
    const variants = [1, 2, 3].map(variant);
    api.listFactRewriteVariants.mockResolvedValue({ variants, remaining: 0 });
    const root = await open();
    expect(root.querySelector('[aria-label="Другой вариант"]')).toBeNull();
    expect(root.querySelector('.var-sw')?.textContent).toBe('1 из 4');
    expect(button(root, 'Применить')).toBeTruthy();
    expect(button(root, 'Отклонить')).toBeTruthy();
  });

  it('вариант не собрался — прежний текст на месте, можно повторить', async () => {
    api.createFactRewriteVariant.mockRejectedValue(new Error('503'));
    const root = await open();
    await press(root, 'Другой вариант');
    await press(root, 'Сделать вариант');
    expect(root.textContent).toContain('Другой вариант не собрался');
    expect(shown(root)).toBe(NOW);
    expect((button(root, 'Сделать вариант') as HTMLButtonElement).disabled).toBe(false);
  });
});
