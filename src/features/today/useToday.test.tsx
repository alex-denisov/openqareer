// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToday, type TodayRead } from './useToday';
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
