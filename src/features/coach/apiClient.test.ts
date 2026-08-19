import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  getApiBaseUrl,
  getStoredSessionToken,
  readData,
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
});
