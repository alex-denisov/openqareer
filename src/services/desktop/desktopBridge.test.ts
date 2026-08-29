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

    // Reporting a stop we never performed is the same fabrication as reporting
    // a route we never measured (PRB-010, B177).
    expect(await stopTunnel()).toBeNull();
  });

  it('never claims a platform application that no desktop performed', async () => {
    const result = await executeLocalAction({
      action_id: 'act-e2e-001',
      capability: 'application.submit',
      platform: 'linkedin',
      payload: { vacancy_id: '123' },
    });

    expect(result).toBeNull();
  });

  it('carries no receipt vocabulary for an action it cannot perform', () => {
    const source = readFileSync(new URL('./desktopBridge.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('completed_with_receipt');
    expect(source).not.toContain('receipt-web-sim');
  });
});
