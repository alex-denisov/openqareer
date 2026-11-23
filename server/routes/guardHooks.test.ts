import Fastify, { type FastifyInstance } from 'fastify';
import { setImmediate as nextTick } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { previewAuth } from './helpers';

const TOKEN = 'preview-token-for-guard-test';

/**
 * B781: охранный хук, который ответил 401 и не вернул reply, пропускает запрос дальше,
 * как только в приложении есть асинхронный onSend: ответ ещё не ушёл, Fastify зовёт
 * обработчик. Каждый вид хука проверяем рядом с таким onSend (на onRequest Fastify и без
 * return успевает остановиться, проверка там — от регресса).
 */
type GuardHook = 'onRequest' | 'preParsing' | 'preValidation' | 'preHandler';

async function guarded(hook: GuardHook) {
  const app = Fastify();
  const calls: string[] = [];
  app.addHook('onSend', async (_request, _reply, payload) => {
    await nextTick();
    return payload;
  });
  app.post('/guarded', { [hook]: previewAuth(TOKEN) }, async (_request, reply) => {
    calls.push('handler');
    return reply.code(201).send({ ok: true });
  });
  await app.ready();
  return { app, calls };
}

describe('B781: охранный хук останавливает запрос при асинхронном onSend', () => {
  let app: FastifyInstance | null = null;
  afterEach(async () => {
    await app?.close();
    app = null;
  });

  for (const hook of ['onRequest', 'preParsing', 'preValidation', 'preHandler'] as const) {
    it(`${hook}: без токена — 401, обработчик не вызван`, async () => {
      const setup = await guarded(hook);
      app = setup.app;
      const response = await app.inject({ method: 'POST', url: '/guarded', payload: {} });
      await nextTick();
      expect(response.statusCode).toBe(401);
      expect(setup.calls).toEqual([]);
    });

    it(`${hook}: с токеном — обработчик отвечает`, async () => {
      const setup = await guarded(hook);
      app = setup.app;
      const response = await app.inject({
        method: 'POST',
        url: '/guarded',
        headers: { authorization: `Bearer ${TOKEN}` },
        payload: {},
      });
      expect(response.statusCode).toBe(201);
      expect(setup.calls).toEqual(['handler']);
    });
  }
});
