import { describe, expect, it, vi } from 'vitest';
import {
  ProtectedRouteError,
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
