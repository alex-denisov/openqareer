import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { receiveCoachResult } from './coachResultDelivery';
import { sendCoachTurn } from './coachApi';

const key = '11111111-1111-4111-8111-111111111111';
const result = { message: 'Ответ 👨‍💻 "цитата" \\ путь\n'.repeat(1_000) };
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });

describe('coach result recovery', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('recovers a lost receipt through GET without another POST', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') throw new Error('lost receipt');
      return json(result);
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendCoachTurn({ content: 'Вопрос', idempotencyKey: key })).toEqual(result);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });

  it('waits for the saved operation and then receives one full response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ status: 'pending' }, 202)).mockResolvedValueOnce(json(result)));
    expect(await receiveCoachResult(key)).toEqual(result);
  });

  it('does not hide an authorization error behind retries', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'unauthorized' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(receiveCoachResult(key)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { offset: 1 }, { byteLength: 0 }, { byteLength: 9_000_000 },
    { sha256: 'invalid' }, { contentBase64: '?' }, { nextOffset: 0 }, { byteLength: 3 },
  ])('rejects malformed part metadata %j', async (override) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (!url.includes('offset=')) return new Response('{');
      return json({ contentBase64: btoa('{}'), offset: 0, nextOffset: null, byteLength: 2,
        sha256: createHash('sha256').update('{}').digest('hex'), ...override });
    }));
    await expect(receiveCoachResult(key)).rejects.toMatchObject({ code: 'delivery_incomplete' });
  });

  it('falls back after a broken full response, retries only the failed part and verifies all bytes', async () => {
    const bytes = Buffer.from(JSON.stringify(result));
    let failedPart = false;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') return json({ status: 'pending', idempotencyKey: key }, 202);
      if (!url.includes('offset=')) return new Response('{"data":', { status: 200 });
      const offset = Number(new URL(url, 'http://localhost').searchParams.get('offset'));
      if (offset === 8192 && !failedPart) { failedPart = true; throw new Error('interrupted'); }
      const end = Math.min(offset + 8192, bytes.length);
      return json({ contentBase64: bytes.subarray(offset, end).toString('base64'), offset,
        nextOffset: end < bytes.length ? end : null, byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await sendCoachTurn({ content: 'Вопрос', idempotencyKey: key })).toEqual(result);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('offset=8192'))).toHaveLength(2);
  });

  it('does not present a corrupted result as complete', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'POST') return json({ status: 'pending', idempotencyKey: key }, 202);
      if (!url.includes('offset=')) throw new Error('broken full response');
      return json({ contentBase64: btoa('{}'), offset: 0, nextOffset: null, byteLength: 2, sha256: '0'.repeat(64) });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(sendCoachTurn({ content: 'Вопрос', idempotencyKey: key })).rejects.toMatchObject({ code: 'delivery_incomplete' });
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });
});
