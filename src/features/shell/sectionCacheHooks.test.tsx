// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTodaySnapshot, recordCandidateVisit, type TodaySnapshot } from '../today/todayApi';
import { useToday } from '../today/useToday';
import { listApplicationsPage, listApplicationsPool } from '../applications/applicationsApi';
import { useApplications } from '../applications/useApplications';
import { lastDaysRange } from '../applications/responsesFiltering';
import { getResumeStudio, saveResumeStudioDraft } from '../resume/resumeApi';
import { useResumeStudio } from '../resume/useResumeStudio';
import type { ResumeStudioView } from '../resume/resumeTypes';
import { getMatchedVacancyPage } from '../coach/coachApi';
import { useMatchedPool } from '../vacancies/useMatchedPool';
import { getCandidateAutomation } from '../automation/automationApi';
import { useAutomationData } from '../automation/useAutomationData';
import { bindSectionCacheOwner, clearSectionCache } from './sectionCache';

vi.mock('../today/todayApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../today/todayApi')>()),
  getTodaySnapshot: vi.fn(),
  recordCandidateVisit: vi.fn(),
}));
vi.mock('../applications/applicationsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../applications/applicationsApi')>()),
  listApplicationsPage: vi.fn(),
  listApplicationsPool: vi.fn(),
}));
vi.mock('../resume/resumeApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../resume/resumeApi')>()),
  getResumeStudio: vi.fn(),
  saveResumeStudioDraft: vi.fn(),
}));
vi.mock('../resume/resumeStudioModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../resume/resumeStudioModel')>()),
  // The fixture draft is minimal; the payload shape is not what these tests check.
  toSavePayload: (draft: unknown) => draft,
}));
vi.mock('../coach/coachApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../coach/coachApi')>()),
  getMatchedVacancyPage: vi.fn(),
  getVacancySources: vi.fn().mockResolvedValue([]),
}));
vi.mock('../automation/automationApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../automation/automationApi')>()),
  getCandidateAutomation: vi.fn(),
  listCandidateAutomationQueue: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  listCandidateAutomationJournal: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
}));

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Renders a hook, keeps its latest value, and remounts it on demand. */
function mountHook<T>(useHook: () => T) {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root | undefined;
  const latest: { current?: T } = {};
  function Probe() {
    latest.current = useHook();
    return null;
  }
  return {
    latest,
    mount() {
      root = createRoot(host);
      act(() => root?.render(<Probe />));
    },
    unmount() {
      act(() => root?.unmount());
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Fixture rows carry only an id; the hook passes them through untouched. */
const fixtureId = (item: unknown) => (item as { clusterId: string }).clusterId;

const todaySnapshot = (headline: string) => ({ headline, queue: [] }) as unknown as TodaySnapshot;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  bindSectionCacheOwner('candidate-b589');
  vi.mocked(recordCandidateVisit).mockResolvedValue(undefined as never);
});

afterEach(() => {
  clearSectionCache();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('B589 section cache in the section hooks', () => {
  it('Today: a repeat visit shows the last day plan before the network answers', async () => {
    vi.mocked(getTodaySnapshot).mockResolvedValueOnce(todaySnapshot('first'));
    const hook = mountHook(useToday);
    hook.mount();
    await flush();
    expect(hook.latest.current?.snapshot).toEqual(todaySnapshot('first'));
    hook.unmount();

    const pending = deferred<TodaySnapshot>();
    vi.mocked(getTodaySnapshot).mockReturnValueOnce(pending.promise);
    hook.mount();
    expect(hook.latest.current?.snapshot).toEqual(todaySnapshot('first'));
    pending.resolve(todaySnapshot('fresh'));
    await flush();
    expect(hook.latest.current?.snapshot).toEqual(todaySnapshot('fresh'));
  });

  it('Today: yesterday’s plan is not shown after midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9, 23, 59));
    vi.mocked(getTodaySnapshot).mockResolvedValueOnce(todaySnapshot('yesterday'));
    const hook = mountHook(useToday);
    hook.mount();
    await flush();
    hook.unmount();

    vi.setSystemTime(new Date(2026, 10, 10, 0, 1));
    vi.mocked(getTodaySnapshot).mockReturnValueOnce(new Promise(() => undefined));
    hook.mount();
    expect(hook.latest.current?.snapshot).toBeNull();
    vi.useRealTimers();
  });

  it('Today: another candidate never sees the previous one’s plan', async () => {
    vi.mocked(getTodaySnapshot).mockResolvedValueOnce(todaySnapshot('first'));
    const hook = mountHook(useToday);
    hook.mount();
    await flush();
    hook.unmount();

    bindSectionCacheOwner('candidate-other');
    vi.mocked(getTodaySnapshot).mockReturnValueOnce(new Promise(() => undefined));
    hook.mount();
    expect(hook.latest.current?.snapshot).toBeNull();
    expect(hook.latest.current?.loading).toBe(true);
  });

  it('Responses: the cached pool stays on screen and is refreshed as the same pool', async () => {
    const item = { id: 'app-1', stage: 'applied', version: 1 };
    vi.mocked(listApplicationsPage).mockResolvedValueOnce({
      items: [item],
      meta: { total: 1 },
    } as never);
    vi.mocked(listApplicationsPool).mockResolvedValue({
      items: [item, { ...item, id: 'app-2' }],
      meta: { total: 2 },
    } as never);
    const hook = mountHook(useApplications);
    hook.mount();
    await flush();
    await act(async () => {
      await hook.latest.current?.loadPool?.(lastDaysRange(30));
    });
    hook.unmount();

    vi.mocked(listApplicationsPage).mockClear();
    const pool = deferred<unknown>();
    vi.mocked(listApplicationsPool).mockReturnValueOnce(pool.promise as never);
    hook.mount();
    expect(hook.latest.current?.status).toBe('ready');
    expect(hook.latest.current?.applications.map((application) => application.id)).toEqual([
      'app-1',
      'app-2',
    ]);
    expect(hook.latest.current?.restoredPool).toEqual(lastDaysRange(30));
    expect(listApplicationsPage).not.toHaveBeenCalled();
    expect(vi.mocked(listApplicationsPool).mock.lastCall?.[0]).toMatchObject({
      stage: [],
      ...lastDaysRange(30),
    });
  });

  it('Responses: a failed background refresh keeps the cached list', async () => {
    vi.mocked(listApplicationsPage).mockResolvedValueOnce({
      items: [{ id: 'app-1', stage: 'applied', version: 1 }],
      meta: { total: 1 },
    } as never);
    const hook = mountHook(useApplications);
    hook.mount();
    await flush();
    hook.unmount();

    vi.mocked(listApplicationsPage).mockRejectedValueOnce(new Error('offline'));
    hook.mount();
    await flush();
    expect(hook.latest.current?.status).toBe('ready');
    expect(hook.latest.current?.applications).toHaveLength(1);
  });

  it('Responses: a pool kept for another period is not restored', async () => {
    vi.mocked(listApplicationsPage).mockResolvedValue({ items: [], meta: { total: 0 } } as never);
    vi.mocked(listApplicationsPool).mockResolvedValue({
      items: [{ id: 'app-7', stage: 'applied', version: 1 }],
      meta: { total: 1 },
    } as never);
    const hook = mountHook(useApplications);
    hook.mount();
    await flush();
    await act(async () => {
      await hook.latest.current?.loadPool?.(lastDaysRange(7));
    });
    hook.unmount();

    hook.mount();
    expect(hook.latest.current?.restoredPool).toBeUndefined();
  });

  it('Profile: the cached draft renders at once and an edit made on it survives the refresh', async () => {
    const view = (title: string) =>
      ({ draft: { headline: title, candidate: {} }, evidence: [] }) as unknown as ResumeStudioView;
    vi.mocked(getResumeStudio).mockResolvedValueOnce(view('first'));
    const hook = mountHook(() => useResumeStudio());
    hook.mount();
    await flush();
    const firstDraft = hook.latest.current?.draft;
    expect(firstDraft).toBeDefined();
    hook.unmount();

    const pending = deferred<ResumeStudioView>();
    vi.mocked(getResumeStudio).mockReturnValueOnce(pending.promise);
    hook.mount();
    expect(hook.latest.current?.draft).toEqual(firstDraft);
    const edited = { ...firstDraft, edited: true } as never;
    act(() => hook.latest.current?.setDraft(edited));
    pending.resolve(view('fresh'));
    await flush();
    expect(hook.latest.current?.draft).toEqual(edited);
    expect(hook.latest.current?.view).toEqual(view('fresh'));
  });

  it('Profile: a save during the first refresh is not overwritten by the older read', async () => {
    const view = (title: string) =>
      ({ draft: { headline: title, candidate: {} }, evidence: [] }) as unknown as ResumeStudioView;
    vi.mocked(getResumeStudio).mockResolvedValueOnce(view('first'));
    const hook = mountHook(() => useResumeStudio());
    hook.mount();
    await flush();
    hook.unmount();

    const pending = deferred<ResumeStudioView>();
    vi.mocked(getResumeStudio).mockReturnValueOnce(pending.promise);
    vi.mocked(saveResumeStudioDraft).mockResolvedValueOnce(view('saved'));
    hook.mount();
    await act(async () => {
      await hook.latest.current?.save();
    });
    expect(hook.latest.current?.saveError).toBeUndefined();
    pending.resolve(view('older'));
    await flush();
    expect(hook.latest.current?.view).toEqual(view('saved'));
  });

  it('Vacancies: the cached selection renders and the refresh swaps it in one step', async () => {
    const page = (ids: readonly string[]) => ({
      items: ids.map((id) => ({ clusterId: id })),
      total: ids.length,
      nextOffset: null,
    });
    vi.mocked(getMatchedVacancyPage).mockResolvedValueOnce(page(['a', 'b']) as never);
    const hook = mountHook(() => useMatchedPool());
    hook.mount();
    await flush();
    expect(hook.latest.current?.matched).toHaveLength(2);
    hook.unmount();

    const pending = deferred<unknown>();
    vi.mocked(getMatchedVacancyPage).mockReturnValueOnce(pending.promise as never);
    hook.mount();
    expect(hook.latest.current?.loading).toBe(false);
    expect(hook.latest.current?.matched.map(fixtureId)).toEqual(['a', 'b']);
    pending.resolve(page(['c']));
    await flush();
    expect(hook.latest.current?.matched.map(fixtureId)).toEqual(['c']);
    expect(hook.latest.current?.total).toBe(1);
  });

  it('Vacancies: a failed background refresh keeps the selection on screen', async () => {
    vi.mocked(getMatchedVacancyPage).mockResolvedValueOnce({
      items: [{ clusterId: 'a' }],
      total: 1,
      nextOffset: null,
    } as never);
    const hook = mountHook(() => useMatchedPool());
    hook.mount();
    await flush();
    hook.unmount();

    vi.mocked(getMatchedVacancyPage).mockRejectedValueOnce(new Error('offline'));
    hook.mount();
    await flush();
    expect(hook.latest.current?.failed).toBe(false);
    expect(hook.latest.current?.matched.map(fixtureId)).toEqual(['a']);
  });

  it('Automation: the cached settings render without the loading state', async () => {
    const snapshot = { settings: { enabled: true } } as never;
    vi.mocked(getCandidateAutomation).mockResolvedValueOnce(snapshot);
    const hook = mountHook(() => useAutomationData('candidate-b589'));
    hook.mount();
    await flush();
    hook.unmount();

    vi.mocked(getCandidateAutomation).mockReturnValueOnce(new Promise(() => undefined));
    hook.mount();
    expect(hook.latest.current?.snapshotLoading).toBe(false);
    expect(hook.latest.current?.snapshot).toEqual(snapshot);
  });
});
