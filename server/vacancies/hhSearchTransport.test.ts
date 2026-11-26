import { describe, expect, it, vi } from 'vitest';
import {
  createDirectHhTransport,
  directHhTransport,
  directThenFallback,
  parseEgressResponse,
  readEgressConfig,
} from './hhSearchTransport';

describe('directHhTransport', () => {
  it('сбой соединения возвращает статус 0 с причиной и временем (B643)', async () => {
    const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed', { cause });
      }),
    );
    try {
      const result = await directHhTransport('https://hh.ru/search/vacancy');
      expect(result.status).toBe(0);
      expect(result.failure).toMatch(/^TypeError ECONNRESET \d+ms headers=- body=- lag=\d+ms$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('keeps the body of a 403 so a per-vacancy restriction can be told from a refusal (prod 28.10)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden page', { status: 403 })),
    );
    try {
      await expect(directHhTransport('https://hh.ru/vacancy/1')).resolves.toEqual({
        status: 403,
        body: 'forbidden page',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createDirectHhTransport (B756)', () => {
  function clock(steps: number[]) {
    let at = 0;
    return () => (at = steps.shift() ?? at);
  }
  function dispatcher() {
    return { destroy: vi.fn(async () => undefined) };
  }

  it('reports headers and body time separately, with the loop lag, on every fetch', async () => {
    const events: unknown[] = [];
    const transport = createDirectHhTransport({
      fetch: async () => new Response('page', { status: 200 }),
      newDispatcher: dispatcher,
      loopLagMs: () => 140,
      now: clock([0, 400, 1_000]),
      onFetch: (event) => events.push(event),
    });
    await expect(transport('https://hh.ru/vacancy/1')).resolves.toEqual({
      status: 200,
      body: 'page',
    });
    expect(events).toEqual([
      {
        status: 200,
        totalMs: 1_000,
        headersMs: 400,
        bodyMs: 600,
        lagMs: 140,
        freshConnection: false,
      },
    ]);
  });

  it('a timeout while the body is read names the body phase', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const response = new Response('x', { status: 200 });
    response.text = async () => {
      throw timeout;
    };
    const transport = createDirectHhTransport({
      fetch: async () => response,
      newDispatcher: dispatcher,
      loopLagMs: () => 0,
      now: clock([0, 300, 30_300]),
    });
    const result = await transport('https://hh.ru/vacancy/1');
    expect(result.failure).toBe('TimeoutError 30300ms headers=300ms body=30000ms+ lag=0ms');
  });

  it('after a timeout the next fetch goes over a new connection and the old one is dropped', async () => {
    const made: ReturnType<typeof dispatcher>[] = [];
    const used: unknown[] = [];
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    let calls = 0;
    const transport = createDirectHhTransport({
      fetch: async (_url, init) => {
        used.push((init as { dispatcher?: unknown }).dispatcher);
        calls += 1;
        if (calls === 1) throw timeout;
        return new Response('page', { status: 200 });
      },
      newDispatcher: () => {
        const next = dispatcher();
        made.push(next);
        return next as never;
      },
      loopLagMs: () => 0,
    });
    expect((await transport('https://hh.ru/vacancy/1')).status).toBe(0);
    expect((await transport('https://hh.ru/vacancy/2')).status).toBe(200);
    expect(made).toHaveLength(2);
    expect(used).toEqual([made[0], made[1]]);
    expect(made[0]!.destroy).toHaveBeenCalled();
  });

  it('an answer from hh, even a refusal, keeps the connection', async () => {
    const made: unknown[] = [];
    const transport = createDirectHhTransport({
      fetch: async () => new Response('', { status: 429 }),
      newDispatcher: () => {
        const next = dispatcher();
        made.push(next);
        return next as never;
      },
      loopLagMs: () => 0,
    });
    await transport('https://hh.ru/vacancy/1');
    await transport('https://hh.ru/vacancy/2');
    expect(made).toHaveLength(1);
  });
});

describe('directThenFallback', () => {
  const forbidden = '{&#34;forbidden&#34;:true,&#34;errorPage&#34;:{&#34;isError&#34;:true}}';
  it('keeps the direct 403 «employer restricted» page instead of the egress refusal (prod 28.10)', async () => {
    const fallback = vi.fn(async () => ({ status: 403, body: '' }));
    const fetch = directThenFallback(async () => ({ status: 403, body: forbidden }), fallback);
    await expect(fetch('https://hh.ru/vacancy/1')).resolves.toEqual({
      status: 403,
      body: forbidden,
    });
    expect(fallback).not.toHaveBeenCalled();
  });
  it('a bare direct 403 still goes to the egress path', async () => {
    const fallback = vi.fn(async () => ({ status: 200, body: 'page' }));
    const fetch = directThenFallback(async () => ({ status: 403, body: '' }), fallback);
    await expect(fetch('https://hh.ru/vacancy/1')).resolves.toEqual({ status: 200, body: 'page' });
  });
});

describe('parseEgressResponse', () => {
  it('делит ответ коннектора на код и тело', () => {
    expect(parseEgressResponse('200 12\n\n<html>тело</html>')).toEqual({
      status: 200,
      body: '<html>тело</html>',
    });
  });

  it('отказ коннектора читается как код, а не как пустой успех', () => {
    expect(parseEgressResponse('000 0 host-not-allowed\n\n')).toEqual({ status: 0, body: '' });
  });

  it('обрезанный ответ — отказ, а не пустая страница', () => {
    expect(parseEgressResponse('мусор без заголовка')).toEqual({ status: 0, body: '' });
  });

  it('тело с пустыми строками не обрезается по ним', () => {
    expect(parseEgressResponse('200 5\n\nа\n\nб').body).toBe('а\n\nб');
  });
});

describe('readEgressConfig', () => {
  it('без настроек запасного пути нет — и это не ошибка', () => {
    expect(readEgressConfig({})).toBeNull();
    expect(readEgressConfig({ OPENQAREER_HH_EGRESS_KEY: '/k' })).toBeNull();
  });

  it('читает путь к ключу и узел', () => {
    expect(
      readEgressConfig({
        OPENQAREER_HH_EGRESS_KEY: ' /srv/key ',
        OPENQAREER_HH_EGRESS_TARGET: ' admin@10.0.0.1 ',
      }),
    ).toEqual({ keyPath: '/srv/key', target: 'admin@10.0.0.1' });
  });
});
