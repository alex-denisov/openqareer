// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { forgetReadResumes } from './hhResumeReading';
import { useHhResumes, type HhResumesState } from './useHhResumes';

const api = vi.hoisted(() => ({
  getHhResumes: vi.fn(),
  saveHhResumes: vi.fn(),
  chooseHhResumeFor: vi.fn(),
  getHhResumeReview: vi.fn(),
}));
const desktop = vi.hoisted(() => ({
  readHhResumes: vi.fn(),
  readHhResumeContent: vi.fn(),
  openHhSignIn: vi.fn(),
}));
vi.mock('./hhSessionApi', () => api);
vi.mock('../../../../services/desktop/desktopBridge', async (original) => ({
  ...(await original<object>()),
  isTauriEnvironment: () => true,
}));
vi.mock('./hhDesktop', async (original) => ({
  ...(await original<typeof import('./hhDesktop')>()),
  ...desktop,
}));

const ITEM = { id: 'r1', title: 'COO', url: 'https://hh.ru/resume/r1' };
const SAVED = {
  resumes: [{ id: 'r1', title: 'COO' }],
  selected: {
    id: 'r1',
    title: 'COO',
    text: 'Опыт',
    sections: {
      title: 'COO',
      about: '',
      skills: [],
      places: [{ employer: 'Ромашка', title: 'CDO', period: '2020', text: 'Вёл данные.' }],
    },
  },
  // Свежий снимок: старый перечитывается при открытии шага (B787).
  readAt: new Date().toISOString(),
} as unknown as HhResumeSnapshot;

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  vi.clearAllMocks();
  forgetReadResumes();
});

async function mount(): Promise<() => HhResumesState> {
  let state: HhResumesState | undefined;
  function Harness() {
    state = useHhResumes('cluster-1', { pace: { minMs: 0, maxMs: 0 } });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => root.render(<Harness />));
  return () => state!;
}

describe('useHhResumes (B710)', () => {
  it('первый выбор при пустом снимке сразу показывает выбранное резюме', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.getHhResumes.mockResolvedValue(null);
    desktop.readHhResumes.mockResolvedValue({ kind: 'ready', resumes: [ITEM] });
    desktop.readHhResumeContent.mockResolvedValue(SAVED.selected);
    api.saveHhResumes.mockResolvedValue(SAVED);
    api.chooseHhResumeFor.mockResolvedValue(SAVED);
    api.getHhResumeReview.mockResolvedValue(null);
    const state = await mount();
    expect(state().snapshot).toBeNull();

    await act(async () => state().openPicker());
    expect(state().picker.kind).toBe('choose');
    await act(async () => state().choose(ITEM));

    expect(api.chooseHhResumeFor).toHaveBeenCalledWith('cluster-1', 'r1');
    expect(state().snapshot).toEqual(SAVED);
    expect(state().picker.kind).toBe('closed');
    expect(state().loading).toBe(false);
  });

  it('B678: открытие листа читает все резюме, сохраняет их и показывает сверку с вакансией', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const SECOND = { id: 'r2', title: 'CTO', url: 'https://hh.ru/resume/r2' };
    const review = {
      vacancyId: 'cluster-1',
      requirements: ['ITIL'],
      recommendedId: 'r2',
      resumes: [
        { resumeId: 'r1', title: 'COO', status: 'gaps', matched: [], missing: ['ITIL'] },
        { resumeId: 'r2', title: 'CTO', status: 'fits', matched: ['ITIL'], missing: [] },
      ],
    };
    api.getHhResumes.mockResolvedValue(SAVED);
    desktop.readHhResumes.mockResolvedValue({ kind: 'ready', resumes: [ITEM, SECOND] });
    desktop.readHhResumeContent.mockImplementation(async (item: { id: string; title: string }) =>
      item.id === 'r2'
        ? Promise.reject(new Error('hh_resume_not_read'))
        : { ...SAVED.selected, id: item.id, title: item.title },
    );
    api.saveHhResumes.mockImplementation(async (resumes, selected, contents) => ({
      resumes,
      selected,
      contents,
      readAt: new Date().toISOString(),
    }));
    api.getHhResumeReview.mockResolvedValue(review);
    const state = await mount();

    await act(async () => state().openPicker());

    expect(desktop.readHhResumeContent).toHaveBeenCalledTimes(2);
    // Не прочиталось одно резюме — чтение остановлено, сверка идёт по прочитанным.
    expect(api.saveHhResumes).toHaveBeenCalledWith(
      [
        { id: 'r1', title: 'COO' },
        { id: 'r2', title: 'CTO' },
      ],
      SAVED.selected,
      [SAVED.selected],
      'cluster-1',
    );
    expect(api.getHhResumeReview).toHaveBeenCalledWith('cluster-1', true);
    const picker = state().picker;
    expect(picker.kind === 'choose' ? picker.review : undefined).toEqual(review);
  });
});
