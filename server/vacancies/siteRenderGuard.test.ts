import { describe, expect, it, vi } from 'vitest';
import { createRequestGuard, type GuardedRoute } from './siteRenderGuard';

interface RouteLog {
  aborted: boolean;
  fulfilledStatus?: number;
  fetched: boolean;
}

function route(url: string, type = 'document', response?: { status: number; location?: string }) {
  const log: RouteLog = { aborted: false, fetched: false };
  const value: GuardedRoute = {
    request: () => ({ url: () => url, resourceType: () => type }),
    abort: async () => {
      log.aborted = true;
    },
    fetch: async () => {
      log.fetched = true;
      const status = response?.status ?? 200;
      return {
        status: () => status,
        headers: (): Record<string, string> =>
          response?.location ? { location: response.location } : {},
      };
    },
    fulfill: async ({ response: r }) => {
      log.fulfilledStatus = r.status();
    },
  };
  return { value, log };
}

const publicOnly = (host: string) => Promise.resolve(!host.endsWith('.private.test'));

describe('createRequestGuard (B643, SSRF)', () => {
  it('публичный адрес загружается через fetch без редиректов', async () => {
    const guard = createRequestGuard(publicOnly);
    const r = route('https://acme.test/careers');
    await guard.handle(r.value);
    expect(r.log).toEqual({ aborted: false, fetched: true, fulfilledStatus: 200 });
  });

  it('частный адрес и IP-литерал обрываются без сети', async () => {
    const guard = createRequestGuard(publicOnly);
    for (const url of [
      'http://127.0.0.1/admin',
      'http://169.254.169.254/latest/meta-data',
      'http://localhost/',
      'https://db.private.test/',
      'https://acme.test:8080/',
      'file:///etc/passwd',
    ]) {
      const r = route(url, 'xhr');
      await guard.handle(r.value);
      expect(r.log.aborted, url).toBe(true);
      expect(r.log.fetched, url).toBe(false);
    }
  });

  it('редирект на 127.0.0.1 обрывается', async () => {
    const guard = createRequestGuard(publicOnly);
    const r = route('https://acme.test/careers', 'document', {
      status: 302,
      location: 'http://127.0.0.1:2375/containers/json',
    });
    await guard.handle(r.value);
    expect(r.log.aborted).toBe(true);
    expect(r.log.fulfilledStatus).toBeUndefined();
  });

  it('относительный редирект на публичный хост отдаётся браузеру', async () => {
    const guard = createRequestGuard(publicOnly);
    const r = route('https://acme.test/careers', 'document', { status: 301, location: '/jobs' });
    await guard.handle(r.value);
    expect(r.log.fulfilledStatus).toBe(301);
  });

  it('картинки, шрифты и медиа не грузятся', async () => {
    const guard = createRequestGuard(publicOnly);
    const r = route('https://acme.test/logo.png', 'image');
    await guard.handle(r.value);
    expect(r.log).toEqual({ aborted: true, fetched: false });
  });

  it('ответ DNS по хосту кэшируется на рендер', async () => {
    const check = vi.fn(publicOnly);
    const guard = createRequestGuard(check);
    await guard.handle(route('https://acme.test/a', 'script').value);
    await guard.handle(route('https://acme.test/b', 'script').value);
    expect(check).toHaveBeenCalledTimes(1);
    await expect(guard.isAllowed('https://acme.test/c')).resolves.toBe(true);
    await expect(guard.isAllowed('http://10.0.0.1/')).resolves.toBe(false);
  });

  it('ошибка fetch обрывает запрос, а не роняет рендер', async () => {
    const guard = createRequestGuard(publicOnly);
    const r = route('https://acme.test/x', 'script');
    const failing: GuardedRoute = {
      ...r.value,
      fetch: async () => {
        throw new Error('net::ERR');
      },
    };
    await expect(guard.handle(failing)).resolves.toBeUndefined();
    expect(r.log.aborted).toBe(true);
  });
});
