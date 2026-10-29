import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamCoachResult } from './coachResultStream';

const KEY = '11111111-1111-4111-8111-111111111111';

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('streamCoachResult (29.10)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the growing text, follows a reset and returns the final result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          ': open\n\n',
          'event: delta\ndata: {"text":"Перв"}\n\nevent: re',
          'set\ndata: {}\n\nevent: delta\ndata: {"text":"Отв"}\n\n',
          'event: delta\ndata: {"text":"ет."}\n\n: ping\n\n',
          'event: done\ndata: {"data":{"message":"Ответ.","analysis":"pending"}}\n\n',
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];

    const result = await streamCoachResult<{ message: string }>(KEY, (text) => seen.push(text));

    expect(result).toEqual({ message: 'Ответ.', analysis: 'pending' });
    expect(seen).toEqual(['Перв', '', 'Отв', 'Ответ.']);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/api/v1/coach/turn/${KEY}/stream`);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Accept: 'text/event-stream',
    });
  });

  it('returns nothing so the caller reads the stored result instead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['event: fallback\ndata: {}\n\n'])),
    );
    expect(await streamCoachResult(KEY, () => undefined)).toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['event: delta\ndata: {"text":"О"}\n\n'])),
    );
    expect(await streamCoachResult(KEY, () => undefined)).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    expect(await streamCoachResult(KEY, () => undefined)).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    expect(await streamCoachResult(KEY, () => undefined)).toBeUndefined();
  });

  it('passes a cancel signal to the stream request', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      expect(init.signal?.aborted).toBe(false);
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    expect(await streamCoachResult(KEY, () => undefined, controller.signal)).toBeUndefined();
    controller.abort();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });
});
