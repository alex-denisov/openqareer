import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deferTodayAction,
  getTodayQueueRemainder,
  getTodaySnapshot,
  recordCandidateVisit,
  TODAY_DECISION_CHANGED,
  todayMomentumMetricValue,
} from './todayApi';
import * as apiClient from '../coach/apiClient';

describe('todayApi', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('records a visit through apiFetch and returns since', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { since: '2026-09-23T09:00:00.000Z' } }), {
        status: 200,
      }),
    );

    const result = await recordCandidateVisit();

    expect(result).toEqual({ since: '2026-09-23T09:00:00.000Z' });
    expect(spy).toHaveBeenCalledWith(
      '/api/v1/candidate/visits',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('reads the today snapshot with the given timezone', async () => {
    const snapshot = {
      digest: {
        waitingForYou: 1,
        newVacancies: 2,
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
    const spy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: snapshot }), { status: 200 }));

    const result = await getTodaySnapshot('Europe/Moscow');

    expect(result).toEqual(snapshot);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/today?tz=Europe%2FMoscow', {
      signal: undefined,
    });
  });

  it('persists a Today action deferral and refreshes open Today views', async () => {
    const actionId = 'a'.repeat(16);
    const deferral = { actionId, deferredThroughDate: '2026-10-17' };
    const fetchSpy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: deferral }), { status: 200 }));
    const dispatchSpy = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: dispatchSpy });

    expect(await deferTodayAction(actionId, 'Europe/Moscow')).toEqual(deferral);
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/candidate/today/action-defer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId, tz: 'Europe/Moscow' }),
    });
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: TODAY_DECISION_CHANGED }),
    );
  });

  it('sends an accepted or dismissed resolution to the server', async () => {
    const actionId = 'c'.repeat(16);
    const deferral = { actionId, deferredThroughDate: '2026-10-29', resolution: 'dismissed' };
    const fetchSpy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: deferral }), { status: 200 }));
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });

    expect(await deferTodayAction(actionId, 'UTC', 'dismissed')).toEqual(deferral);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/v1/candidate/today/action-defer',
      expect.objectContaining({
        body: JSON.stringify({ actionId, tz: 'UTC', resolution: 'dismissed' }),
      }),
    );
  });

  it('fetches the remaining queue for the server-issued revision', async () => {
    const page = {
      queue: [],
      queueTotal: 12,
      queueRevision: 'b'.repeat(64),
      queueOffset: 5,
    };
    const spy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: page }), { status: 200 }));

    expect(await getTodayQueueRemainder('Europe/Moscow', 5, page.queueRevision)).toEqual(page);
    expect(spy).toHaveBeenCalledWith(
      `/api/v1/candidate/today?tz=Europe%2FMoscow&queueOffset=5&queueRevision=${page.queueRevision}`,
      { signal: undefined },
    );
  });

  it('surfaces the server message on failure', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Сессия истекла.' } }), { status: 401 }),
    );
    await expect(getTodaySnapshot('Europe/Moscow')).rejects.toThrow('Сессия истекла.');
  });

  it('accepts funnel counts only with a matching server window, source and sample', () => {
    const endAt = '2026-10-17T12:00:00.000Z';
    const momentum = {
      calculatedAt: endAt,
      windows: {
        '7d': {
          applied: 1,
          views: 'unknown' as const,
          screenings: 'unknown' as const,
          interviews: 0,
        },
        '30d': {
          applied: 2,
          views: 'unknown' as const,
          screenings: 'unknown' as const,
          interviews: 1,
        },
      },
      evidence: {
        '7d': {
          startAt: '2026-10-10T12:00:00.000Z',
          endAt,
          applied: { source: 'application_events.recorded_at' as const, sampleSize: 1 },
          views: { source: 'unavailable' as const, sampleSize: 0, unknownReason: 'no_source' },
          screenings: { source: 'unavailable' as const, sampleSize: 0, unknownReason: 'no_source' },
          interviews: {
            source: 'candidate_interview_schedules.scheduled_at' as const,
            sampleSize: 0,
          },
        },
        '30d': {
          startAt: '2026-09-17T12:00:00.000Z',
          endAt,
          applied: { source: 'application_events.recorded_at' as const, sampleSize: 2 },
          views: { source: 'unavailable' as const, sampleSize: 0, unknownReason: 'no_source' },
          screenings: { source: 'unavailable' as const, sampleSize: 0, unknownReason: 'no_source' },
          interviews: {
            source: 'candidate_interview_schedules.scheduled_at' as const,
            sampleSize: 1,
          },
        },
      },
      burnoutNotice: false,
    };

    expect(todayMomentumMetricValue(momentum, '30d', 'applied')).toBe(2);
    expect(todayMomentumMetricValue(momentum, '30d', 'interviews')).toBe(1);
    expect(todayMomentumMetricValue(momentum, '30d', 'screenings')).toBe('unknown');
    expect(
      todayMomentumMetricValue(
        { calculatedAt: endAt, windows: momentum.windows } as never,
        '30d',
        'applied',
      ),
    ).toBe('unknown');
    expect(
      todayMomentumMetricValue(
        {
          ...momentum,
          evidence: {
            ...momentum.evidence,
            '30d': {
              ...momentum.evidence['30d'],
              applied: { source: 'application_events.recorded_at', sampleSize: 1 },
            },
          },
        },
        '30d',
        'applied',
      ),
    ).toBe('unknown');
  });
});
