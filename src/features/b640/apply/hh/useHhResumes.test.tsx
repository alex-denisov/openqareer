// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HhResumeSnapshot } from '../../../../../shared/hhCandidateSession';
import { useHhResumes, type HhResumesState } from './useHhResumes';

const api = vi.hoisted(() => ({ getHhResumes: vi.fn(), saveHhResumes: vi.fn() }));
const desktop = vi.hoisted(() => ({
  readHhResumes: vi.fn(),
  readHhResumeContent: vi.fn(),
  openHhSignIn: vi.fn(),
}));
vi.mock('./hhSessionApi', () => api);
vi.mock('./hhDesktop', async (original) => ({
  ...(await original<typeof import('./hhDesktop')>()),
  ...desktop,
}));

const ITEM = { id: 'r1', title: 'COO', url: 'https://hh.ru/resume/r1' };
const SAVED = {
  resumes: [{ id: 'r1', title: 'COO' }],
  selected: { id: 'r1', title: 'COO', text: 'Опыт' },
  readAt: '2026-11-19T00:00:00.000Z',
} as unknown as HhResumeSnapshot;

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  vi.clearAllMocks();
});

async function mount(): Promise<() => HhResumesState> {
  let state: HhResumesState | undefined;
  function Harness() {
    state = useHhResumes();
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
    const state = await mount();
    expect(state().snapshot).toBeNull();

    await act(async () => state().openPicker());
    expect(state().picker.kind).toBe('choose');
    await act(async () => state().choose(ITEM));

    expect(api.saveHhResumes).toHaveBeenCalledTimes(1);
    expect(state().snapshot).toEqual(SAVED);
    expect(state().picker.kind).toBe('closed');
    expect(state().loading).toBe(false);
  });
});
