import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { config, candidateAuthorization, createApp, noSessions, successProvider } from '../appTestHarness';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import type { FootprintAdapter, FootprintFinding } from '../osint/adapters/footprintAdapter';
import type { FootprintAdapterSet } from '../osint/adapters/createFootprintAdapters';
import type { FootprintQueryPlanItem } from '../osint/candidateFootprintQueryPlan';
import { startCandidateFootprintAudit, waitForFootprintRun } from '../osint/candidateFootprintWorker';

const lifecycleApps: Array<{
  readonly app: Awaited<ReturnType<typeof buildApp>>;
  readonly candidateStore: SqliteCandidateStore;
  readonly repo: SqliteCandidateReputationRepository;
}> = [];

afterEach(async () => {
  for (const entry of lifecycleApps.splice(0)) {
    await entry.app.close();
    entry.candidateStore.close();
    entry.repo.close();
  }
});

describe('candidate footprint routes', () => {
  it('returns the candidate-owned plan and honest consent/source readiness', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/footprint/plan',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      consent: { approved: false, granted: false, versionId: 'digital_footprint-v1.1' },
      sourceAvailability: {
        sherlock: true,
        maigret: true,
        hibp: false,
        wayback: true,
        exa: false,
      },
      plan: [],
      audit: null,
    });
  });

  it('does not start scans through the legacy or query-plan route while consent text is unapproved', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/footprint/start',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { selectedQueryIds: ['00000000000000000000'] },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('consent_text_not_approved');
    expect(response.json().error.message).toContain('Скоро: ждёт утверждения текста согласия');
    const latest = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/footprint',
      headers: { authorization },
    });
    expect(latest.json().data.audit).toBeNull();
  });

  it('requires candidate authentication for findings and plan mutations', async () => {
    const app = await createApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/candidate/footprint/findings/000000000000000000000000',
      headers: { origin: 'http://localhost:3000' },
      payload: { review: 'confirmed_self' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('cancels and deletes a running footprint audit when the candidate deletes their account', async () => {
    const candidateStore = new SqliteCandidateStore({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const repo = new SqliteCandidateReputationRepository({
      databasePath: ':memory:',
      encryptionKey: config.dataEncryptionKey,
    });
    const app = await buildApp({
      config,
      candidateStore,
      authService: noSessions,
      coachProvider: successProvider,
      candidateReputationRepo: repo,
      serveStatic: false,
    });
    lifecycleApps.push({ app, candidateStore, repo });
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
      candidateId: candidate.id,
      userId: 'test-user',
      plan,
      selectedQueryIds: [plan[0]!.id],
      ownershipConfirmedAt: '2026-10-04T12:00:00.000Z',
      repo,
      adapters,
      isAuthorized: () => true,
    });
    await vi.waitFor(() => expect(waybackRun).toHaveBeenCalledTimes(1));

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/me',
      headers: {
        authorization: `Bearer ${candidate.accessToken}`,
        origin: 'http://localhost:3000',
      },
    });
    await waitForFootprintRun(pending.id);

    expect(deleted.statusCode).toBe(204);
    expect(repo.getLatestFootprintAudit(candidate.id)).toBeNull();
  });
});
