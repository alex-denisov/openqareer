// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import type { LetterVariantsState } from './useLetterVariants';
import { useApprovalHold, useVariantApproval, type ApprovalHold } from './useVariantApproval';

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

function letterOf(pitch: unknown, circlesError = '', text = 'Первое письмо'): LetterScreenState {
  return {
    circles: { data: null, loading: false, error: circlesError, retry: vi.fn() },
    circle: { circle: 3 },
    tone: 'executive',
    language: 'auto',
    draft: {
      pitch,
      workplaces: [],
      text,
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
  let hold: ApprovalHold | undefined;
  function Harness(props: {
    readonly letter: LetterScreenState;
    readonly variants: LetterVariantsState;
  }) {
    hold = useApprovalHold('vac-1');
    state = useVariantApproval('vac-1', props.letter, props.variants, hold);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => root.render(<Harness letter={letter} variants={variants} />));
  const rerender = (next: LetterScreenState, nextVariants: LetterVariantsState) =>
    act(async () => root.render(<Harness letter={next} variants={nextVariants} />));
  return { get: () => state!, hold: () => hold!, rerender };
}

describe('useVariantApproval: одобрение переживает уход с экрана (B711)', () => {
  it('одобренное письмо встаёт сразу после чтения: черновик придержан и не нужен', async () => {
    api.readLatestLetterApproval.mockResolvedValue(STORED);
    const restore = vi.fn();
    const view = await mount(letterOf(null), variantsOf(true, restore));
    expect(view.hold().hold).toBe(true);
    expect(restore).toHaveBeenCalledWith('variant-2', 'Одобренный второй вариант.');
    expect(view.get().approval.saved).toMatchObject({
      applicationId: 'app-1',
      approvedAt: STORED.approvedAt,
    });
  });

  it('пока варианты не прочитаны, одобрение ждёт их', async () => {
    api.readLatestLetterApproval.mockResolvedValue(STORED);
    const restore = vi.fn();
    const view = await mount(letterOf(null), variantsOf(false, restore));
    expect(restore).not.toHaveBeenCalled();
    await view.rerender(letterOf(null), variantsOf(true, restore));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('пока одобрение читается, черновик придержан; без одобрения — отпущен', async () => {
    let resolve: (value: null) => void = () => undefined;
    api.readLatestLetterApproval.mockReturnValue(new Promise((done) => (resolve = done)));
    const view = await mount(letterOf(null), variantsOf(true));
    expect(view.hold().hold).toBe(true);
    await act(async () => resolve(null));
    expect(view.hold().hold).toBe(false);
  });

  it('«Изменить» снимает одобрение и отпускает черновик; пришедший черновик не затирает текст', async () => {
    api.readLatestLetterApproval.mockResolvedValue(STORED);
    const restore = vi.fn();
    const view = await mount(letterOf(null, '', STORED.body), variantsOf(true, restore));
    await act(async () => view.get().approval.reset());
    expect(view.get().approval.saved).toBeNull();
    expect(view.hold().hold).toBe(false);
    restore.mockClear();
    // Черновик собирается, в поле одобренный текст; черновик пришёл и записал своё.
    await view.rerender(letterOf(null, '', 'Правка кандидата'), variantsOf(true, restore));
    await view.rerender(
      letterOf({ emailPitch: {} }, '', 'Новый черновик модели'),
      variantsOf(true, restore),
    );
    expect(restore).toHaveBeenCalledExactlyOnceWith('variant-2', 'Правка кандидата');
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

  it('B645: одобренное письмо показывает язык и тон из снимка, после «Изменить» — выбор кандидата', async () => {
    api.readLatestLetterApproval.mockResolvedValue({
      ...STORED,
      language: 'ru',
      tone: 'confident',
    });
    const view = await mount(letterOf({ emailPitch: {} }), variantsOf(true));
    expect(view.get().language).toBe('ru');
    expect(view.get().tone).toBe('confident');

    await act(async () => view.get().approval.reset());
    expect(view.get().language).toBe('auto');
    expect(view.get().tone).toBe('executive');
  });
});
