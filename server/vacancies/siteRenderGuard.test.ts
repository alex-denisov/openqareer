import { describe, expect, it, vi } from 'vitest';
import type { PinnedFetch, PinnedResponse } from './pinnedFetch';
import { createRequestGuard, isRenderableUrl, type GuardedRoute } from './siteRenderGuard';

interface RouteLog {
  aborted: boolean;
  fulfilledStatus?: number;
}

function route(url: string, type = 'document') {
  const log: RouteLog = { aborted: false };
  const value: GuardedRoute = {
    request: () => ({
      url: () => url,
      resourceType: () => type,
      method: () => 'GET',
      headers: () => ({ accept: 'text/html' }),
      postDataBuffer: () => null,
    }),
    abort: async () => {
      log.aborted = true;
    },
    fulfill: async ({ status }) => {
      log.fulfilledStatus = status;
    },
  };
  return { value, log };
}

function fetcher(response: Partial<PinnedResponse> = {}) {
  return vi.fn<PinnedFetch>(async () => ({
    status: 200,
    headers: {},
    body: Buffer.from('ok'),
    ...response,
  }));
}

describe('createRequestGuard (B643, SSRF)', () => {
  it('публичный адрес загружается через pinnedFetch и отдаётся браузеру', async () => {
    const fetchPinned = fetcher();
    const r = route('https://acme.test/careers');
    await createRequestGuard(fetchPinned).handle(r.value);
    expect(fetchPinned).toHaveBeenCalledWith({
      url: 'https://acme.test/careers',
      method: 'GET',
      headers: { accept: 'text/html' },
      body: null,
    });
    expect(r.log).toEqual({ aborted: false, fulfilledStatus: 200 });
  });

  it('IP-литералы, локальные имена, порты и не-http обрываются без сети', async () => {
    const fetchPinned = fetcher();
    const guard = createRequestGuard(fetchPinned);
    for (const url of [
      'http://127.0.0.1/admin',
      'http://169.254.169.254/latest/meta-data',
      'http://localhost/',
      'http://[::1]/',
      'https://acme.test:8080/',
      'file:///etc/passwd',
    ]) {
      const r = route(url, 'xhr');
      await guard.handle(r.value);
      expect(r.log.aborted, url).toBe(true);
    }
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it('редирект на 127.0.0.1 обрывается', async () => {
    const r = route('https://acme.test/careers');
    const fetchPinned = fetcher({ status: 302, headers: { location: 'http://127.0.0.1:2375/x' } });
    await createRequestGuard(fetchPinned).handle(r.value);
    expect(r.log.aborted).toBe(true);
    expect(r.log.fulfilledStatus).toBeUndefined();
  });

  it('относительный редирект на публичный хост отдаётся браузеру', async () => {
    const r = route('https://acme.test/careers');
    await createRequestGuard(fetcher({ status: 301, headers: { location: '/jobs' } })).handle(
      r.value,
    );
    expect(r.log.fulfilledStatus).toBe(301);
  });

  it('частный адрес в DNS (отказ pinnedFetch при соединении) обрывает запрос', async () => {
    const fetchPinned = vi.fn<PinnedFetch>(async () => {
      throw new Error('private_address');
    });
    const r = route('https://rebind.acme.test/');
    await expect(createRequestGuard(fetchPinned).handle(r.value)).resolves.toBeUndefined();
    expect(r.log.aborted).toBe(true);
  });

  it('картинки, шрифты и медиа не грузятся', async () => {
    const fetchPinned = fetcher();
    const r = route('https://acme.test/logo.png', 'image');
    await createRequestGuard(fetchPinned).handle(r.value);
    expect(r.log.aborted).toBe(true);
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it('isRenderableUrl', () => {
    expect(isRenderableUrl('https://acme.test/careers')).toBe(true);
    expect(isRenderableUrl('http://10.0.0.1/')).toBe(false);
    expect(isRenderableUrl('/jobs', 'https://acme.test/')).toBe(true);
  });

  it('трекеры, аналитика и реклама обрываются без сети', async () => {
    const fetchPinned = fetcher();
    const guard = createRequestGuard(fetchPinned);
    for (const url of [
      'https://www.googletagmanager.com/gtm.js?id=GTM-1',
      'https://www.google-analytics.com/analytics.js',
      'https://stats.g.doubleclick.net/r/collect',
      'https://connect.facebook.net/en_US/fbevents.js',
      'https://mc.yandex.ru/metrika/tag.js',
      'https://static.hotjar.com/c/hotjar-1.js',
      'https://static.cloudflareinsights.com/beacon.min.js',
      'https://s.go-mpulse.net/boomerang/x',
      'https://app.usercentrics.eu/browser-ui/latest/loader.js',
    ]) {
      const r = route(url, 'script');
      await guard.handle(r.value);
      expect(r.log.aborted, url).toBe(true);
    }
    expect(fetchPinned).not.toHaveBeenCalled();
  });

  it('стили не грузятся, скрипты и xhr сайта грузятся', async () => {
    const fetchPinned = fetcher();
    const guard = createRequestGuard(fetchPinned);
    const css = route('https://acme.test/site.css', 'stylesheet');
    await guard.handle(css.value);
    expect(css.log.aborted).toBe(true);
    for (const type of ['script', 'xhr', 'fetch']) {
      const r = route(`https://acme.test/app-${type}`, type);
      await guard.handle(r.value);
      expect(r.log.fulfilledStatus, type).toBe(200);
    }
    expect(fetchPinned).toHaveBeenCalledTimes(3);
  });
});
