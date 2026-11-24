// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const listeners: ((event: { payload: string }) => void)[] = [];
vi.mock('../../services/desktop/desktopBridge', () => ({
  invokeDesktopCommand: (...args: unknown[]) => invoke(...args),
  isTauriEnvironment: () => true,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, handler: (event: { payload: string }) => void) => {
    listeners.push(handler);
    return () => listeners.splice(listeners.indexOf(handler), 1);
  },
}));

import { challengeOf as serverChallengeOf } from '../../../server/auth/appCodeStore';
import { challengeOf, readCallback, signInThroughBrowser } from './desktopBrowserSignIn';

const deliver = (url: string) => listeners.forEach((handler) => handler({ payload: url }));
const opened = () => invoke.mock.calls.at(-1)?.[1] as { challenge: string; state: string };

afterEach(() => {
  invoke.mockReset();
  listeners.splice(0);
  vi.unstubAllGlobals();
});

describe('B755: вход в приложение через браузер', () => {
  it('challenge считается так же, как на сервере', async () => {
    const verifier = 'dBjftJeZ4CVP-mJ92ZqKtXDlJ2s3sU5OPXr7qpVlmgM';
    expect(await challengeOf(verifier)).toBe(serverChallengeOf(verifier));
  });

  it('адрес возврата: свой state — код или отмена; чужой — пропускается', () => {
    expect(readCallback('openqareer://signed-in?code=oqa_1&state=s1', 's1')).toEqual({
      kind: 'code',
      code: 'oqa_1',
    });
    expect(readCallback('openqareer-dev://signed-in?code=oqa_1&state=s1', 's1').kind).toBe('code');
    expect(readCallback('openqareer://signed-in?error=cancel&state=s1', 's1').kind).toBe('cancel');
    expect(readCallback('openqareer://signed-in?code=oqa_1&state=old', 's1').kind).toBe('foreign');
    expect(readCallback('openqareer://evil?code=oqa_1&state=s1', 's1').kind).toBe('foreign');
  });

  it('браузер получает только challenge и state; обмен — код и verifier', async () => {
    invoke.mockResolvedValue(null);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { username: 'candidate.test' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = signInThroughBrowser();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke.mock.calls[0]?.[0]).toBe('desktop_open_sign_in');
    expect(Object.keys(opened()).sort()).toEqual(['challenge', 'site', 'state']);
    deliver(`openqareer://signed-in?code=oqa_old&state=stale-state-0000`);
    deliver(`openqareer://signed-in?code=oqa_1&state=${opened().state}`);

    expect(await pending).toEqual({ username: 'candidate.test' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/auth\/app-code\/exchange$/u);
    const body = JSON.parse(String(init.body)) as { code: string; verifier: string };
    expect(body.code).toBe('oqa_1');
    expect(await challengeOf(body.verifier)).toBe(opened().challenge);
    expect(listeners).toHaveLength(0);
  });

  it('«Отмена» в браузере — без обмена и без ошибки', async () => {
    invoke.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pending = signInThroughBrowser();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    deliver(`openqareer://signed-in?error=cancel&state=${opened().state}`);
    expect(await pending).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('повторное нажатие закрывает прежнюю попытку', async () => {
    invoke.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn());
    const first = signInThroughBrowser();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const second = signInThroughBrowser();
    expect(await first).toBeNull();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    deliver(`openqareer://signed-in?error=cancel&state=${opened().state}`);
    expect(await second).toBeNull();
  });

  it('без ответа из браузера попытка закрывается через 10 минут', async () => {
    vi.useFakeTimers();
    try {
      invoke.mockResolvedValue(null);
      const pending = signInThroughBrowser();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(await pending).toBeNull();
      expect(listeners).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
