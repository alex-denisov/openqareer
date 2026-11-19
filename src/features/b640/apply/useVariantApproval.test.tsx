// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import type { LetterVariantsState } from './useLetterVariants';
import { useVariantApproval } from './useVariantApproval';

const api = vi.hoisted(() => ({
  readLatestLetterApproval: vi.fn(),
  approveVacancyLetter: vi.fn(),
  prepareVacancyLetterResume: vi.fn(),
}));
vi.mock('../../vacancies/vacancyLetterApi', () => api);

const STORED = {
  applicationId: 'app-1',
  documentId: 'doc-1',
  approvedAt: '2026-11-19T10:00:00.000Z',
  status: 'approved' as const,
  sent: false as const,
  resume: null,
  subject: 'Тема',
  body: 'Одобренный второй вариант.',
  variantId: 'variant-2',
};

function letterOf(pitch: unknown, circlesError = ''): LetterScreenState {
  return {
    circles: { data: null, loading: false, error: circlesError, retry: vi.fn() },
    circle: { circle: 3 },
    tone: 'executive',
    language: 'auto',
    draft: {
      pitch,
      workplaces: [],
      text: 'Первое письмо',
      setText: vi.fn(),
      loading: false,
      error: '',
      retry: vi.fn(),
    },
  } as unknown as LetterScreenState;
}

function variantsOf(settled: boolean, restore = vi.fn()): LetterVariantsState {
  return { settled, restore, selected: null, selectedId: null } as unknown as LetterVariantsState;
}

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  vi.clearAllMocks();
});

async function mount(letter: LetterScreenState, variants: LetterVariantsState) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let state: LetterScreenState | undefined;
  function Harness(props: {
    readonly letter: LetterScreenState;
    readonly variants: LetterVariantsState;
  }) {
    state = useVariantApproval('vac-1', props.letter, props.variants);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => root.render(<Harness letter={letter} variants={variants} />));
  const rerender = (next: LetterScreenState, nextVariants: LetterVariantsState) =>
    act(async () => root.render(<Harness letter={next} variants={nextVariants} />));
  return { get: () => state!, rerender };
}

describe('useVariantApproval: одобрение переживает уход с экрана (B711)', () => {
  it('возвращает одобренный вариант и его текст, когда письмо собрано', async () => {
    api.readLatestLetterApproval.mockResolvedValue(STORED);
    const restore = vi.fn();
    const pending = await mount(letterOf(null), variantsOf(false, restore));
    // Черновик ещё собирается: одобрение ждёт, иначе пришедшее письмо перезапишет текст.
    expect(restore).not.toHaveBeenCalled();
    expect(pending.get().approval.saved).toBeNull();

    await pending.rerender(letterOf({ emailPitch: {} }), variantsOf(true, restore));
    expect(restore).toHaveBeenCalledWith('variant-2', 'Одобренный второй вариант.');
    expect(pending.get().approval.saved).toMatchObject({
      applicationId: 'app-1',
      approvedAt: STORED.approvedAt,
    });

    await act(async () => pending.get().approval.reset());
    expect(pending.get().approval.saved).toBeNull();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('без одобрения на сервере письмо не одобрено', async () => {
    api.readLatestLetterApproval.mockResolvedValue(null);
    const restore = vi.fn();
    const view = await mount(letterOf({ emailPitch: {} }), variantsOf(true, restore));
    expect(restore).not.toHaveBeenCalled();
    expect(view.get().approval.saved).toBeNull();
  });

  it('B716: круги связей не загрузились, черновик не просили — одобренное письмо всё равно встаёт', async () => {
    api.readLatestLetterApproval.mockResolvedValue(STORED);
    const restore = vi.fn();
    const view = await mount(letterOf(null, 'Сеть недоступна'), variantsOf(true, restore));
    expect(restore).toHaveBeenCalledWith('variant-2', 'Одобренный второй вариант.');
    expect(view.get().approval.saved).toMatchObject({ applicationId: 'app-1' });
  });
});
