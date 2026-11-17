import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../../coach/apiClient';
import {
  answerStatusSignal,
  getStatusSignal,
  signalStatusPath,
  undoStatusSignalAnswer,
} from './signalApi';

const reply = (data: unknown): Response => new Response(JSON.stringify({ data }), { status: 200 });
const EMPTY = { signal: null, answered: null };
const json = { 'Content-Type': 'application/json' };

describe('b640 today: клиент сигналов', () => {
  afterEach(() => vi.restoreAllMocks());

  it('читает сигнал', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(reply(EMPTY));
    const controller = new AbortController();
    await expect(getStatusSignal(controller.signal)).resolves.toEqual(EMPTY);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/status/signal', {
      signal: controller.signal,
    });
  });

  it('отправляет ответ и отмену ответа', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockImplementation(async () => reply(EMPTY));
    await answerStatusSignal('started_search', 'no');
    expect(spy).toHaveBeenLastCalledWith('/api/v1/candidate/status/signal/answer', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ kind: 'started_search', answer: 'no' }),
    });
    await undoStatusSignalAnswer();
    expect(spy).toHaveBeenLastCalledWith('/api/v1/candidate/status/signal/answer/undo', {
      method: 'POST',
    });
  });

  it('после «Верно» ведёт к выбору статуса с предложением', () => {
    expect(signalStatusPath({ status: 'job_search', targetProfession: null })).toBe(
      '/app/profile/status?status=job_search',
    );
    expect(
      signalStatusPath({ status: 'changing_profession', targetProfession: 'Управление продуктом' }),
    ).toBe(
      '/app/profile/status?status=changing_profession&profession=%D0%A3%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5+%D0%BF%D1%80%D0%BE%D0%B4%D1%83%D0%BA%D1%82%D0%BE%D0%BC',
    );
  });
});
