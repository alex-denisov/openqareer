import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CoachProvider } from './providers/coachProvider';
import { createApp, candidateAuthorization, successProvider } from './appTestHarness';

/** 29.10 (owner): the candidate reads the consultant's reply while it is written. */
function gatedStreamingProvider(texts: { before: string[]; after: string[] }, message: string) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let streamed: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    streamed = resolve;
  });
  const provider: CoachProvider = {
    async createTurn(input, key, options) {
      const base = await successProvider.createTurn(input, key);
      if (options?.split === 'analysis') return base;
      for (const text of texts.before) options?.onMessageText?.(text);
      streamed();
      await gate;
      for (const text of texts.after) options?.onMessageText?.(text);
      return { ...base, result: { ...base.result, message } };
    },
  };
  return { provider, release: () => release(), started };
}

type SseEvent = { event: string; data: unknown };

function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .map((block) => block.split('\n').filter((line) => !line.startsWith(':')))
    .filter((lines) => lines.length > 0 && lines.some((line) => line.startsWith('event:')))
    .map((lines) => ({
      event: lines
        .find((line) => line.startsWith('event:'))!
        .slice(6)
        .trim(),
      data: JSON.parse(lines.find((line) => line.startsWith('data:'))?.slice(5) ?? 'null'),
    }));
}

async function startTurn(app: Awaited<ReturnType<typeof createApp>>, authorization: string) {
  const key = randomUUID();
  const post = await app.inject({
    method: 'POST',
    url: '/api/v1/coach/turn?delivery=receipt',
    headers: { authorization, 'idempotency-key': key },
    payload: {
      messageId: randomUUID(),
      content: 'Почему эта вакансия подходит?',
      stage: 'vacancies',
    },
  });
  expect(post.statusCode).toBe(202);
  return key;
}

describe('поток ответа консультанта (29.10)', () => {
  it('шлёт текст по мере генерации и в конце тот же результат, что и чтение хода', async () => {
    const gated = gatedStreamingProvider(
      { before: ['Отв', 'Ответ'], after: ['Ответ консультанта.'] },
      'Ответ консультанта.',
    );
    const app = await createApp(gated.provider);
    const authorization = candidateAuthorization(app);
    const key = await startTurn(app, authorization);
    await gated.started;

    const stream = app.inject({
      method: 'GET',
      url: `/api/v1/coach/turn/${key}/stream`,
      headers: { authorization },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    gated.release();
    const response = await stream;

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['x-accel-buffering']).toBe('no');
    const events = parseSse(response.body);
    const deltas = events.filter((item) => item.event === 'delta');
    expect(deltas.map((item) => (item.data as { text: string }).text).join('')).toBe(
      'Ответ консультанта.',
    );
    const done = events.at(-1);
    expect(done?.event).toBe('done');
    const stored = await app.inject({
      method: 'GET',
      url: `/api/v1/coach/turn/${key}/result`,
      headers: { authorization },
    });
    // The background analysis may finish between the two reads; the reply itself is the same.
    const { analysis: streamedAnalysis, ...streamed } = (
      done?.data as { data: Record<string, unknown> }
    ).data;
    const { analysis: _storedAnalysis, ...record } = stored.json().data as Record<string, unknown>;
    expect(streamedAnalysis).toBe('pending');
    expect(streamed).toEqual(record);
  });

  it('говорит клиенту сбросить текст, когда следующая ступень начинает заново', async () => {
    const gated = gatedStreamingProvider({ before: ['Перв'], after: ['', 'Втор'] }, 'Второй.');
    const app = await createApp(gated.provider);
    const authorization = candidateAuthorization(app);
    const key = await startTurn(app, authorization);
    await gated.started;

    const stream = app.inject({
      method: 'GET',
      url: `/api/v1/coach/turn/${key}/stream`,
      headers: { authorization },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    gated.release();
    const events = parseSse((await stream).body).map((item) => item.event);

    expect(events).toEqual(['delta', 'reset', 'delta', 'done']);
  });

  it('у завершённого хода сразу отдаёт итог', async () => {
    const gated = gatedStreamingProvider({ before: [], after: [] }, 'Готово.');
    const app = await createApp(gated.provider);
    const authorization = candidateAuthorization(app);
    const key = await startTurn(app, authorization);
    gated.release();
    for (let i = 0; i < 50; i += 1) {
      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/coach/turn/${key}/result`,
        headers: { authorization },
      });
      if (read.statusCode === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/coach/turn/${key}/stream`,
      headers: { authorization },
    });
    const events = parseSse(response.body);

    expect(events.map((item) => item.event)).toEqual(['done']);
    expect((events[0]?.data as { data: { message: string } }).data.message).toBe('Готово.');
  });

  it('чужой или неизвестный ход не отдаёт', async () => {
    const app = await createApp(successProvider);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/coach/turn/${randomUUID()}/stream`,
      headers: { authorization: candidateAuthorization(app) },
    });
    expect(response.statusCode).toBe(404);
  });

  it('закрывает открытый поток при остановке сервера', async () => {
    const gated = gatedStreamingProvider({ before: ['Отв'], after: [] }, 'Ответ.');
    const app = await createApp(gated.provider);
    const authorization = candidateAuthorization(app);
    const key = await startTurn(app, authorization);
    await gated.started;

    const stream = app.inject({
      method: 'GET',
      url: `/api/v1/coach/turn/${key}/stream`,
      headers: { authorization },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closing = app.close();
    const response = await stream;
    gated.release();
    await closing;

    expect(parseSse(response.body).map((item) => item.event)).toEqual(['delta']);
  });
});
