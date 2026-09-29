import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { AuthService } from './auth/authService';
import { SqliteCapabilityConsentStore } from './auth/capabilityConsentStore';
import { config as baseConfig, successProvider } from './appTestHarness';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { FastifyInstance } from 'fastify';

vi.mock('../src/features/legal/capabilityConsents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/legal/capabilityConsents')>();
  return {
    ...actual,
    CAPABILITY_CONSENTS_APPROVED: true,
  };
});

describe('capability consents API routes with approved texts', () => {
  const openApps: FastifyInstance[] = [];
  const openStores: Array<{ close(): void }> = [];
  const openDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(openApps.splice(0).map((app) => app.close()));
    for (const store of openStores.splice(0)) {
      try {
        store.close();
      } catch {
        // Safe against double close
      }
    }
    for (const dir of openDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function createTestEnv() {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-consents-appr-'));
    const databasePath = join(directory, 'test.db');
    const testConfig = { ...baseConfig, databasePath };
    const candidateStore = new SqliteCandidateStore({
      databasePath,
      encryptionKey: baseConfig.dataEncryptionKey,
    });
    const authService = new AuthService({ databasePath, candidateStore });
    const capabilityConsentStore = new SqliteCapabilityConsentStore({ databasePath });

    const app = await buildApp({
      config: testConfig,
      coachProvider: successProvider,
      candidateStore,
      authService,
      capabilityConsentStore,
      serveStatic: false,
    });

    openApps.push(app);
    openStores.push(candidateStore);
    openStores.push(authService);
    openDirs.push(directory);


    return { app, candidateStore, authService, capabilityConsentStore };
  }

  it('отклоняет POST с 400 invalid_request при пустом теле', async () => {
    const { app, authService, candidateStore } = await createTestEnv();
    const reg = await authService.register('val.body.user', 'valid-password-123', candidateStore);
    const authHeader = `Bearer ${reg.sessionToken}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/profile_activity',
      headers: { origin: 'http://localhost:3000', authorization: authHeader },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_request');
  });

  it('отклоняет POST с 409 invalid_consent_version при устаревшей или неверной версии', async () => {
    const { app, authService, candidateStore } = await createTestEnv();
    const reg = await authService.register('val.ver.user', 'valid-password-123', candidateStore);
    const authHeader = `Bearer ${reg.sessionToken}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/profile_activity',
      headers: { origin: 'http://localhost:3000', authorization: authHeader },
      payload: { versionId: 'profile_activity-v0.1-deprecated' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('invalid_consent_version');
  });

  it('успешно сохраняет согласие кандидата при валидной версии и возвращает 200', async () => {
    const { app, authService, candidateStore } = await createTestEnv();
    const reg = await authService.register('granted.user', 'valid-password-123', candidateStore);
    const authHeader = `Bearer ${reg.sessionToken}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/profile_activity',
      headers: { origin: 'http://localhost:3000', authorization: authHeader },
      payload: { versionId: 'profile_activity-v1.0' },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.capability).toBe('profile_activity');
    expect(json.data.granted).toBe(true);
    expect(json.data.consent.versionId).toBe('profile_activity-v1.0');
    expect(json.data.consent.revokedAt).toBeNull();

    // Verify GET immediately reflects granted status
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents/profile_activity',
      headers: { authorization: authHeader },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.granted).toBe(true);
  });
});
