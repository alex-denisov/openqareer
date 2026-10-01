import { describe, expect, it, vi } from 'vitest';
import {
  isClosedSessionWindow,
  startAdminLinkedinRoute,
  transferFailureCopy,
} from './adminLinkedinSessionFlow';

describe('isClosedSessionWindow (B325)', () => {
  it('treats the Tauri missing-window rejection as a closed window', () => {
    expect(isClosedSessionWindow('session_window_missing')).toBe(true);
    expect(isClosedSessionWindow(new Error('session_window_missing'))).toBe(true);
  });

  it('keeps other inspection failures as failures', () => {
    expect(isClosedSessionWindow('eval_timeout')).toBe(false);
    expect(isClosedSessionWindow(new Error('inspection_shape: bad'))).toBe(false);
  });
});

describe('transferFailureCopy (B325)', () => {
  it('names a known desktop reason', () => {
    expect(transferFailureCopy('linkedin_session_cookie_required')).toContain('li_at');
  });

  it('keeps an unknown reason code visible', () => {
    expect(transferFailureCopy(new Error('eval_timeout'))).toContain('eval_timeout');
  });
});

describe('startAdminLinkedinRoute', () => {
  const config = {
    remoteServer: 'openqareer.com',
    remotePort: 2222,
    sshUser: 'openqareer-tunnel',
    sshPrivateKeyBase64: 'a2V5',
    sshHostKeyBase64: 'aG9zdA==',
    proxyUsername: 'oq',
    proxyPassword: 'secret',
    localSocksPort: 1080,
    localHttpPort: 18081,
  };
  const ok = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body }) as Response;

  it('always raises the tunnel, even when LinkedIn is reachable directly', async () => {
    const startTunnel = vi.fn(async () => ({ state: 'running' }) as never);
    await expect(
      startAdminLinkedinRoute({ fetchBootstrap: async () => ok({ data: config }), startTunnel }),
    ).resolves.toBeUndefined();
    expect(startTunnel).toHaveBeenCalledWith(config);
  });

  it('refuses to continue when the tunnel did not reach running', async () => {
    await expect(
      startAdminLinkedinRoute({
        fetchBootstrap: async () => ok({ data: config }),
        startTunnel: async () => ({ state: 'failed' }) as never,
      }),
    ).rejects.toThrow('admin_tunnel_start_failed');
  });

  it('names an unconfigured server route and an expired admin session apart', async () => {
    const startTunnel = vi.fn();
    await expect(
      startAdminLinkedinRoute({ fetchBootstrap: async () => ok({}, 503), startTunnel }),
    ).rejects.toThrow('admin_tunnel_unavailable');
    await expect(
      startAdminLinkedinRoute({ fetchBootstrap: async () => ok({}, 401), startTunnel }),
    ).rejects.toThrow('admin_session_expired');
    expect(startTunnel).not.toHaveBeenCalled();
  });
});
