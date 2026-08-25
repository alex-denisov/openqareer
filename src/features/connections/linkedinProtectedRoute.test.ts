import { describe, expect, it, vi } from 'vitest';
import {
  ProtectedRouteError,
  protectedRouteFailureMessage,
  startLinkedInProtectedRoute,
} from './linkedinProtectedRoute';

const blockedProbe = {
  linkedin: {
    platform: 'linkedin',
    target_url: 'https://www.linkedin.com',
    accessible: false,
  },
  hh: {
    platform: 'hh',
    target_url: 'https://api.hh.ru',
    accessible: true,
  },
  recommendation: 'tunnel_required' as const,
  local_ip_region_hint: 'RU_DIRECT_DETECTED',
  probed_at: '2026-08-20T18:27:00.000Z',
};

describe('startLinkedInProtectedRoute', () => {
  it('reports an expired OpenQareer session before attempting the sidecar', async () => {
    const startTunnel = vi.fn();

    await expect(
      startLinkedInProtectedRoute({
        probeNetwork: vi.fn().mockResolvedValue(blockedProbe),
        fetchBootstrap: vi.fn().mockResolvedValue(new Response('', { status: 401 })),
        startTunnel,
      }),
    ).rejects.toEqual(new ProtectedRouteError('session_expired'));

    expect(startTunnel).not.toHaveBeenCalled();
  });

  it('refuses the direct shortcut when the route was never measured', async () => {
    const config = {
      remoteServer: 'openqareer.com',
      remotePort: 443,
      sshUser: 'openqareer-tunnel',
      sshPrivateKeyBase64: 'private-key',
      sshHostKeyBase64: 'host-key',
      proxyUsername: 'candidate-bound-user',
      proxyPassword: 'synthetic-password-that-is-long-enough',
      localSocksPort: 10_885,
      localHttpPort: 10_886,
    };
    const startTunnel = vi.fn().mockResolvedValue({ state: 'running' });

    await expect(
      startLinkedInProtectedRoute({
        probeNetwork: vi.fn().mockResolvedValue(null),
        fetchBootstrap: vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ data: config }), { status: 200 })),
        startTunnel,
      }),
    ).resolves.toEqual({ tunnelActive: true, probe: null });

    expect(startTunnel).toHaveBeenCalledWith(config);
  });

  it('starts and verifies the sidecar after an authenticated bootstrap', async () => {
    const config = {
      remoteServer: 'openqareer.com',
      remotePort: 443,
      sshUser: 'openqareer-tunnel',
      sshPrivateKeyBase64: 'private-key',
      sshHostKeyBase64: 'host-key',
      proxyUsername: 'candidate-bound-user',
      proxyPassword: 'synthetic-password-that-is-long-enough',
      localSocksPort: 10_885,
      localHttpPort: 10_886,
    };
    const startTunnel = vi.fn().mockResolvedValue({ state: 'running' });

    await expect(
      startLinkedInProtectedRoute({
        probeNetwork: vi.fn().mockResolvedValue(blockedProbe),
        fetchBootstrap: vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ data: config }), { status: 200 })),
        startTunnel,
      }),
    ).resolves.toMatchObject({ tunnelActive: true, probe: blockedProbe.linkedin });

    expect(startTunnel).toHaveBeenCalledWith(config);
  });
});

describe('protected route failure boundaries', () => {
  const directProbe = {
    ...blockedProbe,
    linkedin: { ...blockedProbe.linkedin, accessible: true },
    recommendation: 'direct' as const,
  };

  it('keeps a working direct route off the tunnel entirely', async () => {
    const startTunnel = vi.fn();
    const fetchBootstrap = vi.fn();

    const result = await startLinkedInProtectedRoute({
      probeNetwork: vi.fn().mockResolvedValue(directProbe),
      fetchBootstrap,
      startTunnel,
    });

    expect(result).toEqual({ probe: directProbe.linkedin, tunnelActive: false });
    expect(fetchBootstrap).not.toHaveBeenCalled();
    expect(startTunnel).not.toHaveBeenCalled();
  });

  it('separates an unavailable bootstrap from an invalid one', async () => {
    await expect(
      startLinkedInProtectedRoute({
        probeNetwork: vi.fn().mockResolvedValue(blockedProbe),
        fetchBootstrap: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
        startTunnel: vi.fn(),
      }),
    ).rejects.toEqual(new ProtectedRouteError('bootstrap_unavailable'));

    await expect(
      startLinkedInProtectedRoute({
        probeNetwork: vi.fn().mockResolvedValue(blockedProbe),
        fetchBootstrap: vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
        startTunnel: vi.fn(),
      }),
    ).rejects.toEqual(new ProtectedRouteError('bootstrap_invalid'));

    await expect(
      startLinkedInProtectedRoute({
        probeNetwork: vi.fn().mockResolvedValue(blockedProbe),
        fetchBootstrap: vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
        startTunnel: vi.fn(),
      }),
    ).rejects.toEqual(new ProtectedRouteError('bootstrap_invalid'));
  });

  it('refuses to call a tunnel active when it did not reach running', async () => {
    const bootstrap = () =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { remoteServer: 'openqareer.com' } }), {
          status: 200,
        }),
      );

    await expect(
      startLinkedInProtectedRoute({
        probeNetwork: vi.fn().mockResolvedValue(blockedProbe),
        fetchBootstrap: bootstrap,
        startTunnel: vi.fn().mockResolvedValue({ state: 'failed' }),
      }),
    ).rejects.toEqual(new ProtectedRouteError('tunnel_start_failed'));

    await expect(
      startLinkedInProtectedRoute({
        probeNetwork: vi.fn().mockResolvedValue(blockedProbe),
        fetchBootstrap: bootstrap,
        startTunnel: vi.fn().mockRejectedValue(new Error('sidecar_missing')),
      }),
    ).rejects.toEqual(new ProtectedRouteError('tunnel_start_failed'));
  });
});

describe('protectedRouteFailureMessage', () => {
  it('names the boundary that refused instead of blaming the app', () => {
    expect(
      protectedRouteFailureMessage(new ProtectedRouteError('bootstrap_unavailable')),
    ).toContain('Сервер OpenQareer');
    expect(
      protectedRouteFailureMessage(new ProtectedRouteError('bootstrap_invalid')),
    ).toContain('не распознан');
    expect(
      protectedRouteFailureMessage(new ProtectedRouteError('tunnel_start_failed')),
    ).toContain('не поднялся на этом компьютере');
    expect(protectedRouteFailureMessage(new Error('boom'))).toContain(
      'до открытия окна входа',
    );
    for (const message of [
      protectedRouteFailureMessage(new ProtectedRouteError('bootstrap_unavailable')),
      protectedRouteFailureMessage(new Error('boom')),
    ]) {
      expect(message).toContain('PDF-экспорт профиля');
    }
  });
});
