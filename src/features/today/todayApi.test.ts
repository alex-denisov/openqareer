import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTodaySnapshot, recordCandidateVisit } from './todayApi';
import * as apiClient from '../coach/apiClient';

describe('todayApi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records a visit through apiFetch and returns since', async () => {
    const spy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { since: '2026-09-23T09:00:00.000Z' } }), {
          status: 200,
        }),
      );

    const result = await recordCandidateVisit();

    expect(result).toEqual({ since: '2026-09-23T09:00:00.000Z' });
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/visits', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('reads the today snapshot with the given timezone', async () => {
    const snapshot = {
      digest: { waitingForYou: 1, newVacancies: 2, closedVacancies: 0 },
      queue: [],
      sinceLastVisit: null,
      vacanciesPending: false,
    };
    const spy = vi
      .spyOn(apiClient, 'apiFetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: snapshot }), { status: 200 }));

    const result = await getTodaySnapshot('Europe/Moscow');

    expect(result).toEqual(snapshot);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/today?tz=Europe%2FMoscow');
  });

  it('surfaces the server message on failure', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Сессия истекла.' } }), { status: 401 }),
    );
    await expect(getTodaySnapshot('Europe/Moscow')).rejects.toThrow('Сессия истекла.');
  });
});
