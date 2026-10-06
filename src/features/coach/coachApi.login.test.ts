import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_DEVICE_ID_STORAGE_KEY } from './apiClient';
import { login } from './coachApi';

describe('login device identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the persistent client device id with login', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost:3000' },
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    let headers: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        headers = init?.headers as Record<string, string>;
        return new Response(
          JSON.stringify({
            data: {
              username: 'candidate.test',
              email: null,
              displayName: null,
              role: 'candidate',
              isTest: true,
              candidateId: 'candidate-1',
              sessionToken: 'session-token',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    await login('candidate.test', 'candidate-password-for-tests');

    expect(headers['X-OpenQareer-Device-Id']).toMatch(/^[0-9a-f-]{36}$/iu);
    expect(stored.get(CLIENT_DEVICE_ID_STORAGE_KEY)).toBe(headers['X-OpenQareer-Device-Id']);
  });
});
