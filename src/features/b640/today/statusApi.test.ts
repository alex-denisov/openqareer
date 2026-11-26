import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../../coach/apiClient';
import { getStatusToday, revertStatus } from './statusApi';

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status < 400 ? { data } : { error: data }), { status });
}

describe('b640 today: клиент статуса кандидата', () => {
  afterEach(() => vi.restoreAllMocks());

  it('читает модули «Сегодня» по статусу', async () => {
    const today = {
      status: 'working',
      title: 'Работаю',
      chosen: true,
      modules: [{ key: 'onboarding_plan', title: 'План на первые 90 дней' }],
      revert: null,
    };
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(reply({ today }));
    const controller = new AbortController();

    await expect(getStatusToday(controller.signal)).resolves.toEqual(today);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/status/today', {
      signal: controller.signal,
    });
  });

  it('возвращает прежний статус запросом без тела', async () => {
    const state = { current: { status: 'job_search' }, statuses: [], history: [], revert: null };
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(reply(state));

    await expect(revertStatus()).resolves.toEqual(state);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/status/revert', { method: 'POST' });
  });

  it('ошибку сервера отдаёт вызывающему', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      reply({ code: 'status_revert_unavailable', message: 'Вернуть уже нельзя.' }, 409),
    );
    await expect(revertStatus()).rejects.toThrow('Вернуть уже нельзя.');
  });
});
