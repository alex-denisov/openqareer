import { describe, expect, it, vi } from 'vitest';
import { createScriptPageRenderer, type RenderBrowser, type RenderPage } from './scriptPageRenderer';

interface FakeOptions {
  readonly html?: string;
  readonly gotoDelayMs?: number;
  readonly gotoError?: Error;
}

function fakeBrowser(options: FakeOptions = {}) {
  const state = { open: 0, maxOpen: 0, closedPages: 0, aborted: [] as string[], closed: false };
  const page = (): RenderPage => ({
    route: async (_pattern, handler) => {
      await handler({
        request: () => ({ resourceType: () => 'image' }),
        abort: async () => {
          state.aborted.push('image');
        },
        continue: async () => undefined,
      });
    },
    goto: async () => {
      if (options.gotoDelayMs) await new Promise((r) => setTimeout(r, options.gotoDelayMs));
      if (options.gotoError) throw options.gotoError;
      return null;
    },
    waitForLoadState: async () => undefined,
    content: async () => options.html ?? '<html><body>rendered</body></html>',
    close: async () => undefined,
  });
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
    const render = createScriptPageRenderer({ launch: async () => browser, env: {} });
    await expect(render('https://acme.test/careers')).resolves.toBe('<p>jobs</p>');
    expect(state.aborted).toEqual(['image']);
    expect(state.closedPages).toBe(1);
  });

  it('не больше двух рендеров одновременно, браузер один', async () => {
    const { browser, state } = fakeBrowser({ gotoDelayMs: 20 });
    const launch = vi.fn(async () => browser);
    const render = createScriptPageRenderer({ launch, env: {} });
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((p) => render(`https://acme.test/${p}`)));
    expect(state.maxOpen).toBe(2);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(state.closedPages).toBe(5);
  });

  it('ошибка страницы закрывает контекст и даёт undefined', async () => {
    const { browser, state } = fakeBrowser({ gotoError: new Error('timeout') });
    const render = createScriptPageRenderer({ launch: async () => browser, env: {}, log: vi.fn() });
    await expect(render('https://acme.test/careers')).resolves.toBeUndefined();
    expect(state.closedPages).toBe(1);
  });

  it('браузер не запускается: одна строка журнала, без исключений', async () => {
    const log = vi.fn();
    const launch = vi.fn(async (): Promise<RenderBrowser> => {
      throw new Error('no chrome');
    });
    const render = createScriptPageRenderer({ launch, env: {}, log });
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
    const render = createScriptPageRenderer({ launch, env: {} });
    await expect(render('file:///etc/passwd')).resolves.toBeUndefined();
    expect(launch).not.toHaveBeenCalled();
  });
});
