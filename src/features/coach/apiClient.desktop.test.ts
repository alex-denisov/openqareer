import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, getStoredSessionToken } from './apiClient';
import { getConnections, getSession, login } from './coachApi';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('desktop API failure boundary (B229)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      __TAURI_INTERNALS__: {},
      location: { origin: 'tauri://localhost' },
      localStorage: { getItem: () => 'synthetic-session', setItem: vi.fn(), removeItem: vi.fn() },
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('browser transport unavailable')));
    invoke.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not replay an uncertain native login through WebKit', async () => {
    invoke.mockRejectedValue(new Error('native response lost'));
    await expect(login('synthetic@example.test', 'synthetic-password')).rejects.toMatchObject({
      code: 'network_error', retryable: true,
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(getStoredSessionToken()).toBe('synthetic-session');
  });

  it('bounds connection reads even when IPC never settles', async () => {
    const controller = new AbortController();
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    invoke.mockImplementation(() => new Promise(() => {}));
    const pending = getConnections();
    const rejection = expect(pending).rejects.toMatchObject({ code: 'network_error' });
    expect(deadline).toHaveBeenCalledWith(20_000);
    controller.abort();
    await rejection;
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gives restored sessions the normal read budget instead of two seconds', async () => {
    const deadline = vi.spyOn(AbortSignal, 'timeout');
    invoke.mockResolvedValue({ status: 200, ok: true, headers: {}, body: '{"data":{"candidateId":"synthetic"}}' });
    await expect(getSession()).resolves.toMatchObject({ candidateId: 'synthetic' });
    expect(deadline).toHaveBeenCalledWith(20_000);
  });

  it('does not start a request whose caller has already cancelled it', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(apiFetch('/api/v1/auth/me', { signal: controller.signal })).rejects.toMatchObject({ code: 'network_error' });
    expect(invoke).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves native 204 responses without a duplicate browser request', async () => {
    invoke.mockResolvedValue({ status: 204, ok: true, headers: {}, body: '' });
    const response = await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    expect(response.status).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });
});
