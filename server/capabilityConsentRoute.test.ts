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
import { SqliteCandidateReputationRepository } from './data/sqliteCandidateReputationRepository';
import type { FootprintAdapter, FootprintFinding } from './osint/adapters/footprintAdapter';
import type { FootprintAdapterSet } from './osint/adapters/createFootprintAdapters';
import type { FootprintQueryPlanItem } from './osint/candidateFootprintQueryPlan';
import { startCandidateFootprintAudit, waitForFootprintRun } from './osint/candidateFootprintWorker';

describe('capability consents API routes', () => {
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
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-consents-'));
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

    return { app, candidateStore, authService, capabilityConsentStore, databasePath };
  }

  it('возвращает 401 при обращении без авторизации', async () => {
    const { app } = await createTestEnv();
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents/profile_activity',
    });
    expect(getRes.statusCode).toBe(401);

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/profile_activity',
      headers: { origin: 'http://localhost:3000' },
      payload: { versionId: 'profile_activity-v1.0' },
    });
    expect(postRes.statusCode).toBe(401);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/consents/profile_activity',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(deleteRes.statusCode).toBe(401);
  });

  it('возвращает 403 при неразрешенном origin на POST и DELETE (CSRF)', async () => {
    const { app, authService, candidateStore } = await createTestEnv();
    const reg = await authService.register('csrf.user', 'valid-password-123', candidateStore);
    const cookie = `openqareer_session=${reg.sessionToken}`;

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/profile_activity',
      headers: { origin: 'https://attacker.evil.com', cookie },
      payload: { versionId: 'profile_activity-v1.0' },
    });
    expect(postRes.statusCode).toBe(403);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/consents/profile_activity',
      headers: { origin: 'https://attacker.evil.com', cookie },
    });
    expect(deleteRes.statusCode).toBe(403);
  });


  it('возвращает 404 unknown_capability для несуществующей возможности', async () => {
    const { app, authService, candidateStore } = await createTestEnv();
    const reg = await authService.register('unknown.cap.user', 'valid-password-123', candidateStore);
    const authHeader = `Bearer ${reg.sessionToken}`;

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents/invalid_capability_name',
      headers: { authorization: authHeader },
    });
    expect(getRes.statusCode).toBe(404);
    expect(getRes.json().error.code).toBe('unknown_capability');

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/invalid_capability_name',
      headers: { origin: 'http://localhost:3000', authorization: authHeader },
      payload: { versionId: 'profile_activity-v1.0' },
    });
    expect(postRes.statusCode).toBe(404);
    expect(postRes.json().error.code).toBe('unknown_capability');
  });

  it('отклоняет POST с 409 consent_text_not_approved пока тексты не согласованы владельцем', async () => {
    const { app, authService, candidateStore } = await createTestEnv();
    const reg = await authService.register('unapproved.user', 'valid-password-123', candidateStore);
    const authHeader = `Bearer ${reg.sessionToken}`;

    const postRes = await app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/profile_activity',
      headers: { origin: 'http://localhost:3000', authorization: authHeader },
      payload: { versionId: 'profile_activity-v1.0' },
    });

    expect(postRes.statusCode).toBe(409);
    const body = postRes.json();
    expect(body.error.code).toBe('consent_text_not_approved');
    expect(body.error.message).toContain('на согласовании');
  });

  it('возвращает granted: false до выдачи согласия', async () => {
    const { app, authService, candidateStore } = await createTestEnv();
    const reg = await authService.register('candidate.empty', 'valid-password-123', candidateStore);
    const authHeader = `Bearer ${reg.sessionToken}`;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents/digital_footprint',
      headers: { authorization: authHeader },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.data.capability).toBe('digital_footprint');
    expect(json.data.granted).toBe(false);
    expect(json.data.consent).toBeNull();
  });

  it('отдаёт ранее записанное согласие и поддерживает отзыв через DELETE', async () => {
    const { app, authService, candidateStore, capabilityConsentStore } = await createTestEnv();
    const reg = await authService.register('consenting.user', 'valid-password-123', candidateStore);
    const userId = reg.principal.userId;
    const authHeader = `Bearer ${reg.sessionToken}`;

    capabilityConsentStore.recordConsent({
      userId,
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v1.0',
      grantedAt: '2026-09-29T12:00:00.000Z',
    });

    // 1. GET returns granted: true
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents/actions_on_behalf',
      headers: { authorization: authHeader },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.granted).toBe(true);
    expect(getRes.json().data.consent.versionId).toBe('actions_on_behalf-v1.0');

    // 2. GET /api/v1/me/consents lists it
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents',
      headers: { authorization: authHeader },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().data.consents).toHaveLength(1);

    // 3. DELETE revokes it
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/consents/actions_on_behalf',
      headers: { origin: 'http://localhost:3000', authorization: authHeader },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().data.granted).toBe(false);
    expect(delRes.json().data.revoked).toBe(true);
    expect(delRes.json().data.consent.revokedAt).toBeDefined();

    // 4. Subsequent GET returns granted: false
    const afterDelRes = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents/actions_on_behalf',
      headers: { authorization: authHeader },
    });
    expect(afterDelRes.statusCode).toBe(200);
    expect(afterDelRes.json().data.granted).toBe(false);
    expect(afterDelRes.json().data.consent).toBeNull();
  });

  it('отзыв цифрового следа отменяет активный аудит и удаляет его зашифрованные находки', async () => {
    const { app, authService, candidateStore, capabilityConsentStore, databasePath } = await createTestEnv();
    const reg = await authService.register('footprint.withdraw', 'valid-password-123', candidateStore);
    const candidateId = reg.principal.candidate?.id;
    const userId = reg.principal.userId;
    expect(candidateId).toBeTruthy();
    capabilityConsentStore.recordConsent({
      userId,
      capability: 'digital_footprint',
      versionId: 'digital_footprint-v1.1',
    });
    const repo = new SqliteCandidateReputationRepository({
      databasePath,
      encryptionKey: baseConfig.dataEncryptionKey,
    });
    openStores.push(repo);
    const waybackRun = vi.fn((_input: { profileUrl?: string }, signal: AbortSignal) =>
      new Promise<readonly FootprintFinding[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    );
    const noAdapter = <I>(id: string): FootprintAdapter<I> => ({
      id,
      passive: true,
      run: async (_input: I) => [],
    });
    const adapters: FootprintAdapterSet = {
      sherlock: [],
      maigret: [],
      hibp: noAdapter('hibp'),
      wayback: { id: 'wayback', passive: true, run: waybackRun },
      exa: noAdapter('exa'),
    };
    const plan: FootprintQueryPlanItem[] = [{
      id: '0123456789abcdef0123',
      adapterId: 'wayback',
      kind: 'profile_url',
      preview: 'Проверить публичную страницу',
      selectedByDefault: true,
      input: { profileUrl: 'https://portfolio.example/profile' },
    }];
    const pending = startCandidateFootprintAudit({
      candidateId: candidateId!,
      userId,
      plan,
      selectedQueryIds: [plan[0]!.id],
      ownershipConfirmedAt: '2026-10-04T12:00:00.000Z',
      repo,
      adapters,
      isAuthorized: () => Boolean(capabilityConsentStore.getActiveConsent(userId, 'digital_footprint')),
    });
    await vi.waitFor(() => expect(waybackRun).toHaveBeenCalledTimes(1));

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/consents/digital_footprint',
      headers: { origin: 'http://localhost:3000', authorization: `Bearer ${reg.sessionToken}` },
    });
    await waitForFootprintRun(pending.id);

    expect(deleteResponse.statusCode).toBe(200);
    expect(repo.getLatestFootprintAudit(candidateId!)).toBeNull();
    expect(capabilityConsentStore.getActiveConsent(userId, 'digital_footprint')).toBeNull();
  });

  it('обеспечивает строгую изоляцию между пользователями', async () => {
    const { app, authService, candidateStore, capabilityConsentStore } = await createTestEnv();
    const userA = await authService.register('user.alpha', 'valid-password-123', candidateStore);
    const userB = await authService.register('user.beta', 'valid-password-123', candidateStore);

    capabilityConsentStore.recordConsent({
      userId: userA.principal.userId,
      capability: 'profile_activity',
      versionId: 'profile_activity-v1.0',
    });

    // User A sees granted: true
    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents/profile_activity',
      headers: { authorization: `Bearer ${userA.sessionToken}` },
    });
    expect(resA.json().data.granted).toBe(true);

    // User B sees granted: false
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/me/consents/profile_activity',
      headers: { authorization: `Bearer ${userB.sessionToken}` },
    });
    expect(resB.json().data.granted).toBe(false);
    expect(resB.json().data.consent).toBeNull();
  });

  it('удаляет все согласия пользователя при удалении аккаунта администратором', async () => {
    const { authService, candidateStore, capabilityConsentStore } = await createTestEnv();
    const admin = await authService.register('operator.one', 'valid-password-123', candidateStore);
    authService.setUserRole(admin.principal.userId, 'admin');

    const adminPrincipal = authService.authenticate(admin.sessionToken);

    const user = await authService.register('doomed.user', 'valid-password-123', candidateStore);
    capabilityConsentStore.recordConsent({
      userId: user.principal.userId,
      capability: 'profile_activity',
      versionId: 'profile_activity-v1.0',
    });
    capabilityConsentStore.recordConsent({
      userId: user.principal.userId,
      capability: 'digital_footprint',
      versionId: 'digital_footprint-v1.1',
    });

    expect(capabilityConsentStore.listConsents(user.principal.userId)).toHaveLength(2);

    authService.deleteUserByAdmin(user.principal.userId, adminPrincipal ?? undefined);

    expect(capabilityConsentStore.listConsents(user.principal.userId)).toHaveLength(0);
  });
});
