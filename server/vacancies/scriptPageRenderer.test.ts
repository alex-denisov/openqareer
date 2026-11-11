import { describe, expect, it, vi } from 'vitest';
import {
  createScriptPageRenderer,
  type RenderBrowser,
  type RenderPage,
} from './scriptPageRenderer';

interface FakeOptions {
  readonly html?: string;
  readonly gotoDelayMs?: number;
  readonly gotoError?: Error;
  /** Запросы, которые «страница» делает после перехода, и редирект главного документа. */
  readonly subrequests?: ReadonlyArray<{ url: string; type: string }>;
  readonly redirectTo?: string;
}

const publicOnly = async (host: string) => !host.endsWith('.private.test');

function fakeBrowser(options: FakeOptions = {}) {
  const state = {
    open: 0,
    maxOpen: 0,
    closedPages: 0,
    aborted: [] as string[],
    fetched: [] as string[],
    closed: false,
  };
  const page = (): RenderPage => {
    let handler: Parameters<RenderPage['route']>[1] | undefined;
    let current = 'about:blank';
    const send = async (url: string, type: string, location?: string) => {
      let fulfilled = false;
      await handler?.({
        request: () => ({ url: () => url, resourceType: () => type }),
        abort: async () => {
          state.aborted.push(url);
        },
        fetch: async () => {
          state.fetched.push(url);
          const status = location ? 302 : 200;
          return {
            status: () => status,
            headers: (): Record<string, string> => (location ? { location } : {}),
          };
        },
        fulfill: async () => {
          fulfilled = true;
        },
      });
      return fulfilled;
    };
    return {
      route: async (_pattern, routeHandler) => {
        handler = routeHandler;
      },
      url: () => current,
      goto: async (url) => {
        if (options.gotoDelayMs) await new Promise((r) => setTimeout(r, options.gotoDelayMs));
        if (options.gotoError) throw options.gotoError;
        const followed = await send(url, 'document', options.redirectTo);
        // Как Chrome: оборванный запрос главного документа — goto бросает net::ERR_FAILED.
        if (!followed) throw new Error('net::ERR_FAILED');
        current = followed && options.redirectTo ? options.redirectTo : url;
        if (followed && options.redirectTo) await send(options.redirectTo, 'document');
        await send(`${new URL(url).origin}/logo.png`, 'image');
        for (const sub of options.subrequests ?? []) await send(sub.url, sub.type);
        return null;
      },
      waitForLoadState: async () => undefined,
      content: async () => options.html ?? '<html><body>rendered</body></html>',
      close: async () => undefined,
    };
  };
  const browser: RenderBrowser = {
    isConnected: () => !state.closed,
    close: async () => {
      state.closed = true;
    },
    newContext: async () => {
      state.open += 1;
      state.maxOpen = Math.max(state.maxOpen, state.open);
      return {
        newPage: async () => page(),
        close: async () => {
          state.open -= 1;
          state.closedPages += 1;
        },
      };
    },
  };
  return { browser, state };
}

describe('createScriptPageRenderer (B643)', () => {
  it('рендерит страницу и блокирует картинки', async () => {
    const { browser, state } = fakeBrowser({ html: '<p>jobs</p>' });
    const render = createScriptPageRenderer({
      launch: async () => browser,
      env: {},
      hostIsPublic: publicOnly,
    });
    await expect(render('https://acme.test/careers')).resolves.toBe('<p>jobs</p>');
    expect(state.aborted).toEqual(['https://acme.test/logo.png']);
    expect(state.fetched).toEqual(['https://acme.test/careers']);
    expect(state.closedPages).toBe(1);
  });

  it('не больше двух рендеров одновременно, браузер один', async () => {
    const { browser, state } = fakeBrowser({ gotoDelayMs: 20 });
    const launch = vi.fn(async () => browser);
    const render = createScriptPageRenderer({ launch, env: {}, hostIsPublic: publicOnly });
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((p) => render(`https://acme.test/${p}`)));
    expect(state.maxOpen).toBe(2);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(state.closedPages).toBe(5);
  });

  it('ошибка страницы закрывает контекст и даёт undefined', async () => {
    const { browser, state } = fakeBrowser({ gotoError: new Error('timeout') });
    const render = createScriptPageRenderer({
      launch: async () => browser,
      env: {},
      hostIsPublic: publicOnly,
      log: vi.fn(),
    });
    await expect(render('https://acme.test/careers')).resolves.toBeUndefined();
    expect(state.closedPages).toBe(1);
  });

  it('браузер не запускается: одна строка журнала, без исключений', async () => {
    const log = vi.fn();
    const launch = vi.fn(async (): Promise<RenderBrowser> => {
      throw new Error('no chrome');
    });
    const render = createScriptPageRenderer({ launch, env: {}, hostIsPublic: publicOnly, log });
    await expect(render('https://acme.test/a')).resolves.toBeUndefined();
    await expect(render('https://acme.test/b')).resolves.toBeUndefined();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('OPENQAREER_SITE_RENDER_OFF=1 выключает рендер', async () => {
    const launch = vi.fn(async () => fakeBrowser().browser);
    const render = createScriptPageRenderer({ launch, env: { OPENQAREER_SITE_RENDER_OFF: '1' } });
    await expect(render('https://acme.test/a')).resolves.toBeUndefined();
    expect(launch).not.toHaveBeenCalled();
  });

  it('не http-адрес не открывается', async () => {
    const launch = vi.fn(async () => fakeBrowser().browser);
    const render = createScriptPageRenderer({ launch, env: {}, hostIsPublic: publicOnly });
    await expect(render('file:///etc/passwd')).resolves.toBeUndefined();
    expect(launch).not.toHaveBeenCalled();
  });

  it('запросы страницы к частным адресам обрываются', async () => {
    const { browser, state } = fakeBrowser({
      subrequests: [
        { url: 'http://169.254.169.254/latest/meta-data/', type: 'xhr' },
        { url: 'https://db.private.test/', type: 'fetch' },
        { url: 'https://cdn.acme.test/app.js', type: 'script' },
      ],
    });
    const render = createScriptPageRenderer({
      launch: async () => browser,
      env: {},
      hostIsPublic: publicOnly,
    });
    await expect(render('https://acme.test/careers')).resolves.toBeDefined();
    expect(state.aborted).toContain('http://169.254.169.254/latest/meta-data/');
    expect(state.aborted).toContain('https://db.private.test/');
    expect(state.fetched).toContain('https://cdn.acme.test/app.js');
    expect(state.fetched).not.toContain('https://db.private.test/');
  });

  it('редирект на 127.0.0.1 обрывается, HTML не читается', async () => {
    const { browser, state } = fakeBrowser({ redirectTo: 'http://127.0.0.1/admin' });
    const render = createScriptPageRenderer({
      launch: async () => browser,
      env: {},
      hostIsPublic: publicOnly,
    });
    await expect(render('https://acme.test/careers')).resolves.toBeUndefined();
    expect(state.aborted).toContain('https://acme.test/careers');
    expect(state.fetched).not.toContain('http://127.0.0.1/admin');
  });

  it('стартовый адрес на частном хосте не открывает браузер', async () => {
    const launch = vi.fn(async () => fakeBrowser().browser);
    const render = createScriptPageRenderer({ launch, env: {}, hostIsPublic: publicOnly });
    await expect(render('https://jobs.private.test/')).resolves.toBeUndefined();
    await expect(render('http://10.0.0.5/careers')).resolves.toBeUndefined();
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
