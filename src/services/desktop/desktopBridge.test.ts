import { describe, expect, it } from 'vitest';
import {
  executeLocalAction,
  getDesktopInfo,
  getTunnelStatus,
  isTauriEnvironment,
  probeNetworkStatus,
  startTunnel,
  stopTunnel,
} from './desktopBridge';

describe('desktopBridge', () => {
  it('identifies browser environment honestly when Tauri is not injected', () => {
    expect(isTauriEnvironment()).toBe(false);
  });

  it('provides reliable fallback desktop info in web environment', async () => {
    const info = await getDesktopInfo();
    expect(info.is_desktop_companion).toBe(false);
    expect(info.app_name).toBe('OpenQareer Web');
  });

  it('probes network status and returns structured platform diagnostics', async () => {
    const status = await probeNetworkStatus();
    expect(status.linkedin.platform).toBe('linkedin');
    expect(status.hh.platform).toBe('hh');
    expect(['direct', 'tunnel_required']).toContain(status.recommendation);
    expect(status.probed_at).toBeDefined();
  });

  it('provides split-tunnel routing metadata in tunnel status report', async () => {
    const tunnel = await getTunnelStatus();
    expect(tunnel.active_protocol).toContain('SSH');
    expect(tunnel.split_proxied_domains).toContain('linkedin.com');
    expect(tunnel.split_direct_domains).toContain('hh.ru');
  });

  it('never simulates a running tunnel outside the native desktop runtime', async () => {
    const started = await startTunnel({
      remoteServer: 'openqareer.com',
      remotePort: 443,
      sshUser: 'openqareer-tunnel',
      sshPrivateKeyBase64: Buffer.from(
        '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
      ).toString('base64'),
      sshHostKeyBase64: Buffer.from(
        'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISyntheticHostKeyForTests',
      ).toString('base64'),
      proxyUsername: 'synthetic_user',
      proxyPassword: 'synthetic-password-that-is-long-enough',
      localSocksPort: 10885,
      localHttpPort: 10886,
    });
    expect(started.state).toBe('failed');

    const stopped = await stopTunnel();
    expect(stopped.state).toBe('stopped');
  });

  it('executes local candidate action safely with human pacing and receipt', async () => {
    const result = await executeLocalAction({
      action_id: 'act-e2e-001',
      capability: 'application.submit',
      platform: 'linkedin',
      payload: { vacancy_id: '123' },
    });

    expect(result.action_id).toBe('act-e2e-001');
    expect(result.capability).toBe('application.submit');
    expect(result.status).toBe('completed_with_receipt');
    expect(result.provider_reference).toBeDefined();
    expect(result.pacing_duration_ms).toBeGreaterThan(0);
  });
});
