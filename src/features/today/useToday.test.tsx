// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToday, type TodayRead } from './useToday';
import type { TodaySnapshot } from './todayApi';
import * as apiClient from '../coach/apiClient';

/**
 * `useToday` first posts a visit, then reads the snapshot in the browser's
 * own timezone — no server-truth mock has jsdom, so `apiFetch` is the seam
 * (same pattern as `todayApi.test.ts`).
 */
describe('useToday', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: TodayRead | undefined;

  function Probe() {
    latest = useToday();
    return null;
  }

  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
    latest = undefined;
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  it('visits then reads the snapshot, in order', async () => {
    const snapshot = {
      digest: {
        waitingForYou: 0,
        newVacancies: 3,
        followUpsDueToday: 0,
        followUpsOverdue: 0,
        closedVacancies: 0,
        interviewsAhead: 0,
        nextInterview: null,
        newVacanciesCaption: null,
        followUpCaptions: [],
      },
      queue: [],
      followUps: [],
      sinceLastVisit: { since: null, items: [] },
      vacanciesPending: false,
    };
    const calls: string[] = [];
    vi.spyOn(apiClient, 'apiFetch').mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/visits')) {
        return new Response(JSON.stringify({ data: { since: null } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: snapshot }), { status: 200 });
    });

    await act(async () => {
      root.render(<Probe />);
    });

    expect(calls[0]).toBe('/api/v1/candidate/visits');
    expect(calls[1]).toContain('/api/v1/candidate/today?tz=');
    expect(latest?.loading).toBe(false);
    expect(latest?.failed).toBe(false);
    expect(latest?.snapshot).toEqual(snapshot);
  });

  it('does not move the visit marker on a follow-up action and keeps the last snapshot after a failed refresh', async () => {
    const snapshot = {
      digest: {
        waitingForYou: 0,
        newVacancies: 1,
        followUpsDueToday: 1,
        followUpsOverdue: 0,
        closedVacancies: 0,
        interviewsAhead: 0,
        nextInterview: null,
        newVacanciesCaption: null,
        followUpCaptions: [],
      },
      queue: [],
      followUps: [],
      sinceLastVisit: { since: null, items: [] },
      vacanciesPending: false,
    };
    const calls: Array<{ url: string; method: string }> = [];
    let todayReads = 0;
    vi.spyOn(apiClient, 'apiFetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.includes('/visits')) {
        return new Response(JSON.stringify({ data: { since: null } }), { status: 200 });
      }
      if (url.includes('/events')) {
        return new Response(JSON.stringify({ data: { id: 'app-1' } }), { status: 200 });
      }
      todayReads += 1;
      return todayReads === 1
        ? new Response(JSON.stringify({ data: snapshot }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'temporary failure' } }), { status: 503 });
    });

    await act(async () => {
      root.render(<Probe />);
    });
    const originalSnapshot = latest?.snapshot;

    await act(async () => {
      await latest?.markFollowUpSent('app-1');
    });

    expect(calls.filter(({ url }) => url.includes('/visits'))).toHaveLength(1);
    expect(calls.filter(({ url }) => url.includes('/events'))).toHaveLength(1);
    expect(calls.filter(({ url }) => url.includes('/today'))).toHaveLength(2);
    expect(latest?.snapshot).toBe(originalSnapshot);
    expect(latest?.failed).toBe(false);
    expect(latest?.loading).toBe(false);
  });

  it('ignores an older response when a newer snapshot request has completed', async () => {
    const staleSnapshot = { id: 'stale' } as unknown as TodaySnapshot;
    const freshSnapshot = { id: 'fresh' } as unknown as TodaySnapshot;
    let resolveFirst!: (response: Response) => void;
    let todayReads = 0;
    vi.spyOn(apiClient, 'apiFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/visits')) {
        return new Response(JSON.stringify({ data: { since: null } }), { status: 200 });
      }
      todayReads += 1;
      if (todayReads === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      const data = todayReads === 2 ? freshSnapshot : staleSnapshot;
      return new Response(JSON.stringify({ data }), { status: 200 });
    });

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    await act(async () => {
      await latest?.refresh();
    });
    resolveFirst(new Response(JSON.stringify({ data: staleSnapshot }), { status: 200 }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(latest?.snapshot).toEqual(freshSnapshot);
  });

  it('deduplicates the same follow-up while the paired buttons share one pending ID', async () => {
    let resolveEvent!: (response: Response) => void;
    let eventCalls = 0;
    const snapshot = {
      digest: {
        waitingForYou: 0,
        newVacancies: 0,
        followUpsDueToday: 0,
        followUpsOverdue: 0,
        closedVacancies: 0,
        interviewsAhead: 0,
        nextInterview: null,
        newVacanciesCaption: null,
        followUpCaptions: [],
      },
      queue: [],
      followUps: [],
      sinceLastVisit: { since: null, items: [] },
      vacanciesPending: false,
    };
    vi.spyOn(apiClient, 'apiFetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/visits')) {
        return new Response(JSON.stringify({ data: { since: null } }), { status: 200 });
      }
      if (url.includes('/events')) {
        eventCalls += 1;
        return new Promise<Response>((resolve) => {
          resolveEvent = resolve;
        });
      }
      return new Response(JSON.stringify({ data: snapshot }), { status: 200 });
    });

    await act(async () => {
      root.render(<Probe />);
    });
    let firstMark!: Promise<void>;
    await act(async () => {
      firstMark = latest!.markFollowUpSent('app-1');
      await Promise.resolve();
    });

    expect(latest?.markingFollowUpIds.has('app-1')).toBe(true);
    await act(async () => {
      await latest?.markFollowUpSent('app-1');
    });
    expect(eventCalls).toBe(1);

    resolveEvent(new Response(JSON.stringify({ data: { id: 'app-1' } }), { status: 200 }));
    await act(async () => {
      await firstMark;
    });
    expect(latest?.markingFollowUpIds.has('app-1')).toBe(false);
  });

  it('marks failed when the server rejects', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Сессия истекла.' } }), { status: 401 }),
    );

    await act(async () => {
      root.render(<Probe />);
    });

    expect(latest?.failed).toBe(true);
    expect(latest?.loading).toBe(false);
    expect(latest?.snapshot).toBeNull();
  });
});
