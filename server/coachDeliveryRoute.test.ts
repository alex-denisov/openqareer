import { randomUUID, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { candidateAuthorization, createApp, stores, successProvider, validPayload } from './appTestHarness';

const MESSAGE = 'Полный ответ 👨‍💻 "цитата" \\ путь\n'.repeat(150).trim();

describe('durable coach delivery (B198)', () => {
  it('acknowledges a slow operation immediately and does not start it again while pending', async () => {
    let finish!: (value: Awaited<ReturnType<typeof successProvider.createTurn>>) => void;
    const createTurn = vi.fn(() => new Promise<Awaited<ReturnType<typeof successProvider.createTurn>>>((resolve) => { finish = resolve; }));
    const app = await createApp({ createTurn });
    const key = randomUUID();
    const authorization = candidateAuthorization(app);
    const post = () => app.inject({ method: 'POST', url: '/api/v1/coach/turn?delivery=receipt',
      headers: { authorization, 'idempotency-key': key }, payload: validPayload });
    expect((await post()).statusCode).toBe(202);
    expect((await post()).statusCode).toBe(202);
    const pending = await app.inject({ method: 'GET', url: `/api/v1/coach/turn/${key}/result`, headers: { authorization } });
    expect(pending.statusCode).toBe(202);
    expect(createTurn).toHaveBeenCalledTimes(1);
    finish(await successProvider.createTurn({} as never, 'fixture'));
    await new Promise((resolve) => setImmediate(resolve));
    expect((await app.inject({ method: 'GET', url: `/api/v1/coach/turn/${key}/result?offset=999999`, headers: { authorization } })).statusCode).toBe(416);
  });

  it('persists provider failure and reading the failure never generates again', async () => {
    const createTurn = vi.fn(async () => { throw new Error('provider unavailable'); });
    const app = await createApp({ createTurn });
    const key = randomUUID();
    const authorization = candidateAuthorization(app);
    await app.inject({ method: 'POST', url: '/api/v1/coach/turn?delivery=receipt',
      headers: { authorization, 'idempotency-key': key }, payload: validPayload });
    await new Promise((resolve) => setImmediate(resolve));
    const failed = await app.inject({ method: 'GET', url: `/api/v1/coach/turn/${key}/result`, headers: { authorization } });
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error.code).toBe('turn_failed');
    expect(createTurn).toHaveBeenCalledTimes(1);
  });

  it('returns a small receipt and reads the exact result without generating twice', async () => {
    const base = await successProvider.createTurn({} as never, 'fixture');
    const output = { ...base, result: { ...base.result, message: MESSAGE, completeness: { known: Array(20).fill('Ф'.repeat(300)), unknown: Array(20).fill('Я'.repeat(300)) } } };
    const createTurn = vi.fn(async () => output);
    const app = await createApp({ createTurn });
    const key = randomUUID();
    const authorization = candidateAuthorization(app);
    const post = () => app.inject({ method: 'POST', url: '/api/v1/coach/turn?delivery=receipt',
      headers: { authorization, 'idempotency-key': key }, payload: validPayload });
    const receipt = await post();
    expect(receipt.statusCode).toBe(202);
    expect(Buffer.byteLength(receipt.body)).toBeLessThan(1_024);
    expect(receipt.json().data).toEqual({ status: 'pending', idempotencyKey: key });
    expect((await post()).statusCode).toBe(200);
    let offset: number | null = 0;
    const parts: Buffer[] = [];
    let digest = '';
    while (offset !== null) {
      const part: Awaited<ReturnType<typeof app.inject>> = await app.inject({ method: 'GET', url: `/api/v1/coach/turn/${key}/result?offset=${offset}`, headers: { authorization } });
      expect(part.statusCode).toBe(200);
      expect(Buffer.byteLength(part.body)).toBeLessThanOrEqual(12_288);
      const data = part.json().data;
      expect(data.offset).toBe(offset);
      if (digest) expect(data.sha256).toBe(digest);
      digest = data.sha256;
      parts.push(Buffer.from(data.contentBase64, 'base64'));
      offset = data.nextOffset;
    }
    const bytes = Buffer.concat(parts);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    expect(JSON.parse(bytes.toString())).toEqual(output.result);
    expect(createTurn).toHaveBeenCalledTimes(1);
    const full = await app.inject({ method: 'GET', url: `/api/v1/coach/turn/${key}/result`, headers: { authorization } });
    expect(full.json().data).toEqual(output.result);
    const anonymous = await app.inject({ method: 'GET', url: `/api/v1/coach/turn/${key}/result?offset=0` });
    expect(anonymous.statusCode).toBe(401);
    const other = stores.at(-1)!.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/coach/turn/${key}/result?offset=0`, headers: { authorization: `Bearer ${other.accessToken}` } });
    expect(foreign.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/v1/coach/turn/${key}/result?offset=-1`, headers: { authorization } })).statusCode).toBe(422);
  });
});
