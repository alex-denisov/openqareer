// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LetterScreenState } from '../../vacancies/vacancyLetterController';
import type { LetterVariantsState } from './useLetterVariants';
import { useApprovalHold, useVariantApproval, type ApprovalHold } from './useVariantApproval';

const api = vi.hoisted(() => ({
  readStoredLetter: vi.fn(),
  saveLetterDraft: vi.fn(),
  removeLetterDraft: vi.fn(),
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
    circle: { circle: 3, selectedPathId: null },
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
    api.readStoredLetter.mockResolvedValue({ approval: STORED });
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
    api.readStoredLetter.mockResolvedValue({ approval: STORED });
    const restore = vi.fn();
    const view = await mount(letterOf(null), variantsOf(false, restore));
    expect(restore).not.toHaveBeenCalled();
    await view.rerender(letterOf(null), variantsOf(true, restore));
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('пока одобрение читается, черновик придержан; без одобрения — отпущен', async () => {
    let resolve: (value: { approval: null }) => void = () => undefined;
    api.readStoredLetter.mockReturnValue(new Promise((done) => (resolve = done)));
    const view = await mount(letterOf(null), variantsOf(true));
    expect(view.hold().hold).toBe(true);
    await act(async () => resolve({ approval: null }));
    expect(view.hold().hold).toBe(false);
  });

  it('«Изменить» снимает одобрение и отпускает черновик; пришедший черновик не затирает текст', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: STORED });
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
    api.readStoredLetter.mockResolvedValue({ approval: null });
    const restore = vi.fn();
    const view = await mount(letterOf({ emailPitch: {} }), variantsOf(true, restore));
    expect(restore).not.toHaveBeenCalled();
    expect(view.get().approval.saved).toBeNull();
  });

  it('B716: круги связей не загрузились, черновик не просили — одобренное письмо всё равно встаёт', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: STORED });
    const restore = vi.fn();
    const view = await mount(letterOf(null, 'Сеть недоступна'), variantsOf(true, restore));
    expect(restore).toHaveBeenCalledWith('variant-2', 'Одобренный второй вариант.');
    expect(view.get().approval.saved).toMatchObject({ applicationId: 'app-1' });
  });

  it('B645: одобренное письмо показывает язык и тон из снимка, после «Изменить» — выбор кандидата', async () => {
    api.readStoredLetter.mockResolvedValue({
      approval: { ...STORED, language: 'ru', tone: 'confident' },
    });
    const view = await mount(letterOf({ emailPitch: {} }), variantsOf(true));
    expect(view.get().language).toBe('ru');
    expect(view.get().tone).toBe('confident');

    await act(async () => view.get().approval.reset());
    expect(view.get().language).toBe('auto');
    expect(view.get().tone).toBe('executive');
  });
});

describe('письмо и изменившиеся факты профиля', () => {
  const CHANGED = { ...STORED, factsChanged: true, profileChanged: true };
  const pitch = (id: string) => ({ emailPitch: {}, usedEvidenceIds: [], language: 'ru', profileHash: id });

  it('число опровергнуто — письмо не одобрено, отправить нельзя, пока не пересобрано', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: CHANGED });
    const view = await mount(letterOf(null), variantsOf(true));
    expect(view.get().approval.saved).toBeNull();
    expect(view.get().approval.stale).toBe(true);
    expect(view.hold().hold).toBe(true);
  });

  it('пересборка ставит в поле новое письмо, а прежнюю правку убирает', async () => {
    const draft = { body: STORED.body, variantId: null, savedAt: STORED.approvedAt, factsChanged: true };
    api.removeLetterDraft.mockResolvedValue(undefined);
    api.readStoredLetter.mockResolvedValue({ approval: CHANGED, draft });
    const restore = vi.fn();
    const view = await mount(letterOf(null, '', STORED.body), variantsOf(true, restore));
    await act(async () => view.get().approval.rebuild!());
    expect(view.get().approval.stale).toBe(false);
    expect(view.hold().hold).toBe(false);
    restore.mockClear();
    await view.rerender(letterOf(null, '', STORED.body), variantsOf(true, restore));
    await view.rerender(letterOf(pitch('b'), '', 'Новое письмо'), variantsOf(true, restore));
    expect(restore).not.toHaveBeenCalled();
    expect(api.removeLetterDraft).toHaveBeenCalledWith('vac-1');
  });

  it('профиль изменился без опровергнутых чисел — «Изменить» тоже пересобирает', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: { ...STORED, factsChanged: false, profileChanged: true } });
    const restore = vi.fn();
    const view = await mount(letterOf(null, '', STORED.body), variantsOf(true, restore));
    expect(view.get().approval.saved).not.toBeNull();
    await act(async () => view.get().approval.reset());
    restore.mockClear();
    await view.rerender(letterOf(pitch('b'), '', 'Новое письмо'), variantsOf(true, restore));
    expect(restore).not.toHaveBeenCalled();
  });

  it('после «Изменить» смена тона ставит новое письмо: прежний текст бережём один раз', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: STORED });
    const restore = vi.fn();
    const view = await mount(letterOf(null, '', STORED.body), variantsOf(true, restore));
    await act(async () => view.get().approval.reset());
    await view.rerender(letterOf(pitch('a'), '', 'Черновик'), variantsOf(true, restore));
    restore.mockClear();
    const warm = (value: unknown, text: string) => ({ ...letterOf(value, '', text), tone: 'confident' as const });
    await view.rerender(warm(null, STORED.body), variantsOf(true, restore));
    await view.rerender(warm(pitch('a'), 'Тёплое письмо'), variantsOf(true, restore));
    expect(restore).not.toHaveBeenCalled();
  });

  it('возврат в окно: факты исправили в другой вкладке — письмо больше не одобрено', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: STORED });
    const view = await mount(letterOf(null), variantsOf(true));
    expect(view.get().approval.stale).toBe(false);
    api.readStoredLetter.mockResolvedValue({ approval: CHANGED });
    await act(async () => void window.dispatchEvent(new Event('focus')));
    expect(view.get().approval.stale).toBe(true);
    expect(view.get().approval.saved).toBeNull();
  });
});

describe('правка письма до одобрения', () => {
  const DRAFT = { body: 'Моя правка.', variantId: null, savedAt: '2026-11-24T20:00:00.000Z', factsChanged: false };

  it('сохраняется после паузы и при уходе с экрана', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: null });
    api.saveLetterDraft.mockResolvedValue(undefined);
    const view = await mount(letterOf({ emailPitch: {}, profileHash: 'a' }), variantsOf(true));
    await act(async () => view.get().draft.setText('Правка кандидата'));
    expect(api.saveLetterDraft).not.toHaveBeenCalled();
    await act(async () => void window.dispatchEvent(new Event('pagehide')));
    expect(api.saveLetterDraft).toHaveBeenCalledExactlyOnceWith('vac-1', { body: 'Правка кандидата', profileHash: 'a' });
  });

  it('после перезагрузки в поле правка, а не одобренный текст; одобренный можно вернуть', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: STORED, draft: DRAFT });
    api.removeLetterDraft.mockResolvedValue(undefined);
    const restore = vi.fn();
    const view = await mount(letterOf(null), variantsOf(true, restore));
    expect(restore).toHaveBeenCalledWith(null, 'Моя правка.');
    expect(view.get().approval.saved).toBeNull();
    expect(view.hold().hold).toBe(false);
    await act(async () => view.get().approval.revert!());
    expect(api.removeLetterDraft).toHaveBeenCalledWith('vac-1');
    expect(restore).toHaveBeenLastCalledWith('variant-2', STORED.body);
    expect(view.get().approval.saved).toMatchObject({ documentId: 'doc-1' });
    expect(view.hold().hold).toBe(true);
  });

  it('пришедший черновик модели правку не затирает', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: null, draft: DRAFT });
    const restore = vi.fn();
    const view = await mount(letterOf(null), variantsOf(true, restore));
    await view.rerender(letterOf(null, '', DRAFT.body), variantsOf(true, restore));
    restore.mockClear();
    await view.rerender(letterOf({ emailPitch: {} }, '', 'Черновик модели'), variantsOf(true, restore));
    expect(restore).toHaveBeenCalledExactlyOnceWith(null, 'Моя правка.');
  });

  it('черновик пришёл раньше вариантов: правка встаёт и с сервера не убирается', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: null, draft: DRAFT });
    const restore = vi.fn();
    const pitch = { emailPitch: {} };
    const view = await mount(letterOf(null), variantsOf(false, restore));
    await view.rerender(letterOf(pitch), variantsOf(false, restore));
    await view.rerender(letterOf(pitch), variantsOf(true, restore));
    expect(restore).toHaveBeenCalledExactlyOnceWith(null, 'Моя правка.');
    expect(api.removeLetterDraft).not.toHaveBeenCalled();
  });

  it('правка с опровергнутым числом ждёт пересборки', async () => {
    api.readStoredLetter.mockResolvedValue({ approval: null, draft: { ...DRAFT, factsChanged: true } });
    const view = await mount(letterOf(null), variantsOf(true));
    expect(view.get().approval.stale).toBe(true);
    expect(view.hold().hold).toBe(true);
  });
});
