import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logout } from './coachApi';
import { getStoredSessionToken, setStoredSessionToken } from './apiClient';

/**
 * PRB-022 — выход обязан гаснуть на сервере, а не только в браузере.
 *
 * Токен стирался до отправки запроса, поэтому `POST /auth/logout` уходил без
 * единственного удостоверения, которое есть у десктопа: там нет cookie, и
 * серверная сессия оставалась живой до истечения срока. Сервер отвечает `204`
 * в обоих случаях, поэтому клиент об этом не узнавал.
 */
describe('PRB-022 · выход гасит сессию на сервере', () => {
  // Хранилище токена живёт в `window.localStorage`, а прогон идёт в node:
  // без окна вся эта ветка молча ничего не делает, и проверка стала бы
  // тавтологией.
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { origin: 'https://openqareer.com' },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
    setStoredSessionToken('session-token-1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('отправляет запрос выхода с удостоверением, а не пустым', async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await logout();

    expect(seen[0]?.Authorization).toBe('Bearer session-token-1');
  });

  it('стирает токен после ответа сервера, а не до запроса', async () => {
    let tokenWhileAsking: string | null = 'не спрашивали';
    const fetchMock = vi.fn().mockImplementation(() => {
      tokenWhileAsking = getStoredSessionToken();
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await logout();

    expect(tokenWhileAsking).toBe('session-token-1');
    expect(getStoredSessionToken()).toBeNull();
  });

  it('не оставляет удостоверение в браузере, даже если сервер не ответил', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    await expect(logout()).rejects.toThrow();
    expect(getStoredSessionToken()).toBeNull();
  });

  it('не оставляет удостоверение в браузере, когда сервер отказал', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'нет сессии' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(logout()).rejects.toThrow();
    expect(getStoredSessionToken()).toBeNull();
  });
});
