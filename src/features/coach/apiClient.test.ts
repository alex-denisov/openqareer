import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  CoachApiError,
  getApiBaseUrl,
  getStoredSessionToken,
  readData,
  SESSION_EXPIRED_EVENT,
  SESSION_TOKEN_STORAGE_KEY,
  setStoredSessionToken,
} from './apiClient';

describe('apiClient', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const storageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    };

    // Provide a mocked window environment
    (globalThis as unknown as { window: unknown }).window = {
      location: { origin: 'http://localhost:3000' },
      localStorage: storageMock,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('manages session token in local storage', () => {
    expect(getStoredSessionToken()).toBeNull();

    setStoredSessionToken('test-session-token-123');
    expect(getStoredSessionToken()).toBe('test-session-token-123');
    expect(mockStorage[SESSION_TOKEN_STORAGE_KEY]).toBe('test-session-token-123');

    setStoredSessionToken(null);
    expect(getStoredSessionToken()).toBeNull();
    expect(mockStorage[SESSION_TOKEN_STORAGE_KEY]).toBeUndefined();
  });

  it('resolves relative base URL in normal web environment and remote backend for tauri', () => {
    expect(getApiBaseUrl()).toBe('');

    (globalThis as unknown as { window: { location: { origin: string } } }).window.location.origin = 'tauri://localhost';
    expect(getApiBaseUrl()).toBe('https://openqareer.com');
  });

  it('automatically stores sessionToken returned in envelope data', async () => {
    const mockResponse = new Response(
      JSON.stringify({
        data: {
          username: 'candidate.one',
          role: 'candidate',
          sessionToken: 'stored-auth-token-456',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

    const data = await readData<{ username: string; sessionToken?: string }>(mockResponse);
    expect(data.username).toBe('candidate.one');
    expect(getStoredSessionToken()).toBe('stored-auth-token-456');
  });

  it('attaches Authorization Bearer header when token is stored', async () => {
    setStoredSessionToken('active-user-bearer-token');

    let capturedHeaders: Record<string, string> = {};
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ data: { status: 'ok' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const response = await apiFetch('/api/v1/candidate/me');
    expect(fetchSpy).toHaveBeenCalled();
    expect(capturedHeaders.Authorization).toBe('Bearer active-user-bearer-token');
    expect(capturedHeaders.Accept).toBe('application/json');

    const data = await readData(response);
    expect(data).toEqual({ status: 'ok' });
  });

  /**
   * WKWebView — the engine the desktop app runs on — rejects a non-JSON body
   * with `SyntaxError: The string did not match the expected pattern.`
   * Unguarded, that engine string travelled all the way into the cabinet
   * header and was shown to the owner as the product's own message
   * (INC-027, owner report 2026-08-26).
   */
  describe('a response that is not JSON', () => {
    it('becomes a typed API error instead of the engine\'s own words', async () => {
      const response = new Response('<!doctype html><title>502</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });

      await expect(readData(response)).rejects.toMatchObject({
        name: 'CoachApiError',
        code: 'malformed_response',
        retryable: true,
      });
    });

    it('never repeats the engine sentence the owner saw', async () => {
      const response = new Response('not json at all', { status: 200 });

      const reason = await readData(response).catch((error: unknown) => error);

      expect(reason).toBeInstanceOf(CoachApiError);
      expect((reason as CoachApiError).message).not.toContain('did not match');
    });
  });

  /**
   * PRB-038. Каждый экран отвечал на свой `401` своим красным текстом, а профиль
   * из кэша оставалось на месте. Истёкшая сессия — одно событие для всего
   * приложения, и App решает, что показать.
   */
  describe('an unauthorized response (PRB-038)', () => {
    it('announces the expired session once for the whole app', async () => {
      const dispatched: string[] = [];
      (globalThis as unknown as { window: { dispatchEvent: (event: Event) => boolean } }).window
        .dispatchEvent = (event: Event) => {
        dispatched.push(event.type);
        return true;
      };
      const response = new Response(
        JSON.stringify({ error: { code: 'unauthorized', message: 'Нужна действующая сессия.' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );

      await expect(readData(response)).rejects.toMatchObject({ code: 'unauthorized' });
      expect(dispatched).toEqual([SESSION_EXPIRED_EVENT]);
    });

    it('stays silent for other failures', async () => {
      const dispatched: string[] = [];
      (globalThis as unknown as { window: { dispatchEvent: (event: Event) => boolean } }).window
        .dispatchEvent = (event: Event) => {
        dispatched.push(event.type);
        return true;
      };
      const response = new Response(JSON.stringify({ error: { code: 'not_found' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });

      await expect(readData(response)).rejects.toMatchObject({ code: 'not_found' });
      expect(dispatched).toEqual([]);
    });
  });
});
