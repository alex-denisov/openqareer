import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { AuthService } from '../auth/authService';
import { SqliteCapabilityConsentStore } from '../auth/capabilityConsentStore';
import { config as baseConfig, successProvider } from '../appTestHarness';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { SqliteCandidateActionRepository } from '../candidate/sqliteCandidateActionRepository';
import {
  CandidateActionExecutor,
  SimulatedCandidatePlatformRunner,
} from '../candidate/candidateActionExecutor';
import { LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';

describe('Candidate Action Routes (B261)', () => {
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

  async function createTestEnv(options: { withExecutor?: boolean } = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-candidate-actions-'));
    const databasePath = join(directory, 'test.db');
    const testConfig = { ...baseConfig, databasePath };
    const candidateStore = new SqliteCandidateStore({
      databasePath,
      encryptionKey: baseConfig.dataEncryptionKey,
    });
    const authService = new AuthService({ databasePath, candidateStore });
    const capabilityConsentStore = new SqliteCapabilityConsentStore({ databasePath });
    const candidateActionRepository = new SqliteCandidateActionRepository({ databasePath });
    const candidateActionExecutor = new CandidateActionExecutor({
      repository: candidateActionRepository,
      consentStore: capabilityConsentStore,
      applicationTracker: candidateStore,
      runner: new SimulatedCandidatePlatformRunner(),
      sessionResolver: {
        resolve: async (requestedCandidateId, platform) => ({
          candidateId: requestedCandidateId,
          platform,
          page: {} as never,
        }),
      },
      pause: async () => undefined,
    });

    const app = await buildApp({
      config: testConfig,
      coachProvider: successProvider,
      candidateStore,
      authService,
      capabilityConsentStore,
      candidateActionRepository,
      ...(options.withExecutor === false ? {} : { candidateActionExecutor }),
      serveStatic: false,
    });

    openApps.push(app);
    openStores.push(candidateStore);
    openStores.push(capabilityConsentStore);
    openStores.push(candidateActionRepository);
    openDirs.push(directory);

    // Register a test candidate
    const email = `candidate-${Date.now()}@example.com`;
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: baseConfig.allowedOrigins[0] },
      payload: {
        email,
        displayName: 'Тестовый Кандидат',
        password: 'Password123!',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });
    expect(regRes.statusCode).toBe(201);
    const candidateToken = String(regRes.headers['set-cookie']).split(';')[0];
    const candidateId = regRes.json().data.candidateId;

    return {
      app,
      candidateToken,
      candidateId,
      capabilityConsentStore,
      candidateActionRepository,
    };
  }

  it('rejects unauthenticated requests to candidate actions', async () => {
    const { app } = await createTestEnv();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/actions/receipts',
    });
    expect(res.statusCode).toBe(401);
  });

  it('fails with 400 when confirmedByCandidate is false', async () => {
    const { app, candidateToken } = await createTestEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/actions/batch',
      headers: {
        origin: baseConfig.allowedOrigins[0],
        cookie: candidateToken,
      },
      payload: {
        confirmedByCandidate: false,
        actions: [
          {
            platform: 'hh',
            actionKind: 'hh_apply',
            targetUrl: 'https://hh.ru/vacancy/123',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('candidate_confirmation_required');
  });

  it('fails with 403 when consent for actions_on_behalf is not granted', async () => {
    const { app, candidateToken } = await createTestEnv();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/actions/batch',
      headers: {
        origin: baseConfig.allowedOrigins[0],
        cookie: candidateToken,
      },
      payload: {
        confirmedByCandidate: true,
        actions: [
          {
            platform: 'hh',
            actionKind: 'hh_apply',
            targetUrl: 'https://hh.ru/vacancy/123',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe('consent_required');
  });

  it('answers 503 and sends nothing when no real platform runner is connected', async () => {
    const { app, candidateToken, candidateId, capabilityConsentStore, candidateActionRepository } =
      await createTestEnv({ withExecutor: false });
    capabilityConsentStore.recordConsent({
      userId: candidateId,
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v1.0',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/actions/batch',
      headers: { origin: baseConfig.allowedOrigins[0], cookie: candidateToken },
      payload: {
        confirmedByCandidate: true,
        actions: [{ platform: 'hh', actionKind: 'hh_apply', targetUrl: 'https://hh.ru/vacancy/123' }],
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('runner_not_connected');
    expect(res.json().error.message).toContain('не подключён');
    expect(candidateActionRepository.listReceipts(candidateId, 10)).toHaveLength(0);
  });

  it('executes batch when confirmed and consent is present', async () => {
    // The route reads the real clock; pin it to 15:00 Moscow so the run does
    // not land in quiet hours when CI happens to run at night (B331).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { app, candidateToken, candidateId, capabilityConsentStore } = await createTestEnv();

    // Directly record consent for test
    capabilityConsentStore.recordConsent({
      userId: candidateId,
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v1.0',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/actions/batch',
      headers: {
        origin: baseConfig.allowedOrigins[0],
        cookie: candidateToken,
      },
      payload: {
        batchId: '00000000-0000-4000-8000-000000000011',
        confirmedByCandidate: true,
        actions: [
          {
            platform: 'hh',
            actionKind: 'hh_apply',
            targetUrl: 'https://hh.ru/vacancy/123',
            letterText: 'Добрый день!',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe('completed');
    expect(body.data.receipts).toHaveLength(1);
    expect(body.data.receipts[0].status).toBe('delivered');
    expect(body.data.receipts[0]).not.toHaveProperty('targetUrl');
    expect(body.data.receipts[0]).not.toHaveProperty('letterText');
    // Время и пояс задаёт сервер; клиентское время не входит в контракт.
    expect(Math.abs(Date.parse(body.data.receipts[0].executedAt) - Date.now())).toBeLessThan(60_000);

    // Check receipts endpoint
    const receiptsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/actions/receipts?batchId=00000000-0000-4000-8000-000000000011',
      headers: {
        cookie: candidateToken,
      },
    });
    expect(receiptsRes.statusCode).toBe(200);
    expect(receiptsRes.json().data.receipts).toHaveLength(1);
    expect(receiptsRes.json().data.receipts[0]).not.toHaveProperty('letterText');
    expect(receiptsRes.json().data.receipts[0]).not.toHaveProperty('targetUrl');

    // Check usage endpoint
    const usageRes = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/actions/usage',
      headers: {
        cookie: candidateToken,
      },
    });
    expect(usageRes.statusCode).toBe(200);
    expect(usageRes.json().data.usage.hhAppliesCount).toBe(1);
  });

  it('stops execution when kill switch is toggled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { app, candidateToken, candidateId, capabilityConsentStore } = await createTestEnv();

    capabilityConsentStore.recordConsent({
      userId: candidateId,
      capability: 'actions_on_behalf',
      versionId: 'actions_on_behalf-v1.0',
    });

    // Toggle kill-switch ON
    const killRes = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/actions/kill-switch',
      headers: {
        origin: baseConfig.allowedOrigins[0],
        cookie: candidateToken,
      },
      payload: {
        active: true,
        reason: 'Candidate clicked stop',
      },
    });
    expect(killRes.statusCode).toBe(200);
    expect(killRes.json().data.active).toBe(true);

    // Run batch -> should be aborted
    const batchRes = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/actions/batch',
      headers: {
        origin: baseConfig.allowedOrigins[0],
        cookie: candidateToken,
      },
      payload: {
        confirmedByCandidate: true,
        actions: [
          {
            platform: 'hh',
            actionKind: 'hh_apply',
            targetUrl: 'https://hh.ru/vacancy/123',
          },
        ],
      },
    });

    expect(batchRes.statusCode).toBe(200);
    const body = batchRes.json();
    expect(body.data.status).toBe('aborted');
    expect(body.data.receipts[0].status).toBe('failed');
    expect(body.data.receipts[0].failureCode).toBe('kill_switch_active');
  });

  it('returns and manually clears only the authenticated candidate’s LinkedIn safety stop', async () => {
    const { app, candidateToken, candidateId, candidateActionRepository } = await createTestEnv();
    candidateActionRepository.setKillSwitch(
      `candidate:${candidateId}:linkedin`,
      true,
      'platform_restricted',
    );

    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/actions/usage',
      headers: { cookie: candidateToken },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().data.linkedinSafetyStop).toMatchObject({
      paused: true,
      reason: 'platform_restricted',
      canResume: true,
    });

    const resumeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/actions/kill-switch',
      headers: { origin: baseConfig.allowedOrigins[0], cookie: candidateToken },
      payload: { active: false, platform: 'linkedin' },
    });
    expect(resumeRes.statusCode).toBe(200);
    expect(resumeRes.json().data.linkedinSafetyStop).toMatchObject({ paused: false, reason: null });
  });
});
