import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  executeLocalAction,
  isTauriEnvironment,
  probeNetworkStatus,
  startTunnel,
  stopTunnel,
} from './desktopBridge';

describe('desktopBridge', () => {
  it('identifies browser environment honestly when Tauri is not injected', () => {
    expect(isTauriEnvironment()).toBe(false);
  });

  it('reports no network measurement at all when the native probe is absent', async () => {
    expect(await probeNetworkStatus()).toBeNull();
  });

  it('carries no invented latency, status code or route recommendation', () => {
    const source = readFileSync(new URL('./desktopBridge.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('latency_ms:');
    expect(source).not.toContain('status_code:');
    expect(source).not.toContain('WEB_FALLBACK_MODE');
    expect(source).not.toContain("recommendation: 'direct'");
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
