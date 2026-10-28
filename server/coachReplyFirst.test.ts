import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CoachProvider, CoachTurnOptions } from './providers/coachProvider';
import { createApp, candidateAuthorization, successProvider } from './appTestHarness';

/**
 * 28.10 (owner): a dialog turn answers with the consultant first; the expert and
 * strategist run after it and add their proposals and track to the same turn.
 */
function splitProvider() {
  const seen: Array<CoachTurnOptions['split']> = [];
  let releaseAnalysis: () => void = () => {};
  const analysisGate = new Promise<void>((resolve) => {
    releaseAnalysis = resolve;
  });
  const provider: CoachProvider = {
    async createTurn(input, key, options) {
      seen.push(options?.split);
      const base = await successProvider.createTurn(input, key);
      if (options?.split !== 'analysis') {
        return { ...base, result: { ...base.result, message: 'Ответ консультанта.' } };
      }
      await analysisGate;
      return {
        ...base,
        result: {
          ...base.result,
          message: 'Вывод стратега.',
          completeness: { known: [], unknown: ['Разбор стратега'] },
        },
      };
    },
  };
  return { provider, seen, releaseAnalysis: () => releaseAnalysis() };
}

describe('ответ консультанта сразу, разбор фоном (28.10)', () => {
  it('отдаёт ответ консультанта до разбора и дописывает разбор в тот же ход', async () => {
    const split = splitProvider();
    const app = await createApp(split.provider);
    const authorization = candidateAuthorization(app);
    const key = randomUUID();
    const turn = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': key },
      payload: {
        messageId: randomUUID(),
        content: 'Почему эта вакансия подходит?',
        stage: 'vacancies',
      },
    });
    expect(turn.statusCode).toBe(200);
    expect(turn.json().data.message).toBe('Ответ консультанта.');
    const read = async () =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/coach/turn/${key}/result`,
          headers: { authorization },
        })
      ).json().data;
    expect((await read()).analysis).toBe('pending');

    split.releaseAnalysis();
    let done = await read();
    for (let i = 0; i < 50 && done.analysis === 'pending'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      done = await read();
    }
    expect(split.seen).toEqual(['reply', 'analysis']);
    expect(done).toMatchObject({ analysis: 'ready', message: 'Ответ консультанта.' });
    expect(done.completeness.unknown).toContain('Разбор стратега');
  });

  it('«Сегодня» отвечает одним консультантом без фонового разбора', async () => {
    const split = splitProvider();
    const app = await createApp(split.provider);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization: candidateAuthorization(app), 'idempotency-key': randomUUID() },
      payload: { messageId: randomUUID(), content: 'С чего начать?', stage: 'today' },
    });
    expect(response.json().data.analysis).toBeUndefined();
    expect(split.seen).toEqual([undefined]);
  });
});

describe('зависший разбор (28.10)', () => {
  it('pending старше пяти минут читается как failed: процесс мог перезапуститься', async () => {
    const { withStaleAnalysis, ANALYSIS_STALE_MS } = await import('./routes/coachTurnAnalysis');
    const startedAt = '2026-10-28T20:00:00.000Z';
    const base = { analysis: 'pending' as const, analysisStartedAt: startedAt };
    const at = (ms: number) => Date.parse(startedAt) + ms;
    expect(withStaleAnalysis(base, at(ANALYSIS_STALE_MS - 1)).analysis).toBe('pending');
    expect(withStaleAnalysis(base, at(ANALYSIS_STALE_MS + 1)).analysis).toBe('failed');
    expect(ANALYSIS_STALE_MS).toBe(5 * 60_000);
    // A ready analysis or a turn without one stays as it is.
    expect(
      withStaleAnalysis({ analysis: 'ready' as const }, at(10 * ANALYSIS_STALE_MS)).analysis,
    ).toBe('ready');
    expect(withStaleAnalysis({}, at(10 * ANALYSIS_STALE_MS))).toEqual({});
  });
});
