// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachApiError } from '../../coach/apiClient';
import type { AuthUser } from '../../coach/coachApi';
import { click, mount, type Mounted } from '../kit/testDom';
import { ShellProvider } from '../shell/ShellContext';
import { ResumeEditCard } from './ResumeEditCard';

const api = vi.hoisted(() => ({
  requestFactRewrite: vi.fn(),
  applyFactRewrite: vi.fn(),
  revertFactRewrite: vi.fn(),
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

async function open(factId = 'm1'): Promise<HTMLElement> {
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
      <ResumeEditCard factId={factId} memory={[]} />
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
  api.requestFactRewrite.mockResolvedValue(proposal);
  api.applyFactRewrite.mockResolvedValue({ id: 'r1' });
  api.revertFactRewrite.mockResolvedValue(undefined);
  api.getResumeStudio.mockResolvedValue({ draft });
  api.saveResumeStudioDraft.mockResolvedValue(undefined);
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.clearAllMocks();
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

  it('«Применить» пишет только этот пункт, «Отменить» возвращает', async () => {
    const root = await open();
    await press(root, 'Применить');
    expect(api.applyFactRewrite).toHaveBeenCalledWith('p1', {}, ['e1#1']);
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

  it('консультант не ответил — «Ответ не пришёл», «Повторить» спрашивает снова', async () => {
    api.requestFactRewrite.mockRejectedValueOnce(new Error('503'));
    const root = await open();
    expect(root.querySelector('[role=alert]')?.textContent).toContain('Ответ не пришёл');
    await press(root, 'Повторить');
    expect(root.textContent).toContain(NOW);
  });
});
