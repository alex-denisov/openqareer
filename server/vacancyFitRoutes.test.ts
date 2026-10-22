import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VacancyCluster } from './domain/unifiedVacancy';
import { VacancyMechanicsRuntime } from './domain/vacancyMechanicsRuntime';
import { currentVacancyFitProfileStamp, currentVacancyFitProfileValidator } from './domain/vacancyFitProfileStamp';
import type { VacancyFitInput } from './domain/vacancyFit';
import type { BulkLlmClient } from './providers/bulkLlmClient';
import { createApp, login } from './testHelpers/vacancyPitchHarness';

const cluster: VacancyCluster = {
  id: 'cluster-fit', canonicalTitle: 'Senior Platform Engineer', canonicalCompany: 'Synthetic company',
  canonicalLocation: 'Remote', isRemote: true, descriptionSummary: 'Requirements\n- TypeScript required',
  skills: ['Untrusted source skill'], primaryUrl: 'https://example.test/jobs/fit', sources: [],
  firstObservedAt: '2026-10-18T00:00:00Z', lastSeenAt: '2026-10-18T00:00:00Z', status: 'active', vacanciesCount: 1,
};
const endpoint = '/api/v1/candidate/vacancies/cluster-fit/fit';
const origin = 'http://localhost:3000';
afterEach(() => vi.restoreAllMocks());

describe('candidate vacancy fit HTTP boundary', () => {
  it('requires auth and safe mutation origin; unknown vacancy never queues work', async () => {
    const { app } = await createApp([cluster]);
    expect((await app.inject({ method: 'GET', url: endpoint })).statusCode).toBe(401);
    const { cookie } = await login(app);
    expect((await app.inject({ method: 'POST', url: endpoint, headers: { cookie, origin: 'https://attacker.invalid' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/candidate/vacancies/absent/fit', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/candidate/vacancies/absent/fit', headers: { cookie, origin } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: endpoint, headers: { cookie } })).json().data.state).toBe('not_requested');
  });

  it('HTTP enqueues without provider calls; worker produces cached evidence and GET does not restart work', async () => {
    const { app, databasePath } = await createApp([cluster]);
    const { cookie } = await login(app);
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('HTTP must not call provider'));
    for (let n = 0; n < 2; n += 1) {
      const response = await app.inject({ method: 'POST', url: endpoint, headers: { cookie, origin }, payload: { facts: [{ statement: 'attacker supplied' }], coveragePercent: 100 } });
      expect(response.statusCode).toBe(202);
      expect(response.json().data.state).toBe('processing');
    }
    expect(fetch).not.toHaveBeenCalled();
    const worker = new VacancyMechanicsRuntime(databasePath, Buffer.alloc(32, 8));
    try {
      await worker.runNext(null);
      const response = await app.inject({ method: 'GET', url: endpoint, headers: { cookie } });
      expect(String(response.headers['cache-control'])).toContain('no-store');
      expect(response.json().data).toMatchObject({ state: 'ready', result: { coveragePercent: null, status: 'unknown' } });
      expect(response.json().data.requirements[0].text).toBe('TypeScript required');
      expect(JSON.stringify(response.json())).not.toContain('attacker supplied');
      expect(await worker.runNext(null)).toBe(false);
      const cached = await app.inject({ method: 'POST', url: endpoint, headers: { cookie, origin } });
      expect(cached.json().data.state).toBe('ready');
      expect(await worker.runNext(null)).toBe(false);
    } finally { worker.close(); }
  });

  it('does not expose another candidates result and invalidates own cache after profile edits', async () => {
    const { app, candidates, auth, databasePath } = await createApp([cluster]);
    const { cookie, candidateId } = await login(app);
    await app.inject({ method: 'POST', url: endpoint, headers: { cookie, origin } });
    const worker = new VacancyMechanicsRuntime(databasePath, Buffer.alloc(32, 8));
    try {
      await worker.runNext(null);
      await auth.seedAccounts([{ username: 'candidate.other', password: 'other-candidate-password', role: 'candidate' }], candidates);
      const second = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username: 'candidate.other', password: 'other-candidate-password' } });
      const otherCookie = String(second.headers['set-cookie']).split(';')[0];
      const other = await app.inject({ method: 'GET', url: `${endpoint}?candidateId=${candidateId}`, headers: { cookie: otherCookie } });
      expect(other.json().data.result).toBeUndefined();
      expect(other.json().data.state).toBe('not_requested');
      candidates.addManualExperienceFact(candidateId, 'new-profile-fact', 'I built TypeScript services.');
      expect((await app.inject({ method: 'GET', url: endpoint, headers: { cookie } })).json().data.result).toBeUndefined();
      const deleted = await app.inject({ method: 'DELETE', url: '/api/v1/candidate/me', headers: { cookie, origin } });
      expect(deleted.statusCode).toBe(204);
      expect(worker.database.prepare('SELECT COUNT(*) AS n FROM vacancy_fit_cache').get()).toMatchObject({ n: 0 });
      expect(worker.database.prepare('SELECT COUNT(*) AS n FROM vacancy_fit_queue').get()).toMatchObject({ n: 0 });
    } finally { worker.close(); }
  });

  it.each([
    ['Не могу подтвердить право на работу в Germany.', 'unknown'],
    ['Без права на работу в Germany.', 'unknown'],
    ['I do not have work authorization in Germany.', 'unknown'],
    ['I have work authorization in Germany.', 'matched'],
  ])('work authorization respects the meaning of confirmed evidence: %s', async (statement, expected) => {
    const { app, candidates, databasePath } = await createApp([{ ...cluster, canonicalLocation: 'Germany' }]);
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, { sourceLabel: 'synthetic', entries: [{ memoryId: 'auth-evidence', domain: 'constraint', statement }] });
    candidates.reviewMemories(candidateId, ['auth-evidence'], 'confirm');
    await app.inject({ method: 'POST', url: endpoint, headers: { cookie, origin } });
    const worker = new VacancyMechanicsRuntime(databasePath, Buffer.alloc(32, 8));
    try {
      await worker.runNext(null);
      const response = await app.inject({ method: 'GET', url: endpoint, headers: { cookie } });
      expect(response.json().data.result.gates.workAuthorization.status).toBe(expected);
      expect(response.json().data.result.coveragePercent).toBeNull();
    } finally { worker.close(); }
  });

  it.each(['delete-memory', 'correct-memory', 'mark-sensitive', 'delete-candidate'])('checks authoritative profile again before candidate data leaves: %s', async (change) => {
    const { app, candidates, databasePath } = await createApp([cluster]);
    const { candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, { sourceLabel: 'synthetic', entries: [{ memoryId: 'profile-check', domain: 'outcome', statement: 'I built TypeScript services.' }] });
    candidates.reviewMemories(candidateId, ['profile-check'], 'confirm');
    const validate = currentVacancyFitProfileValidator(candidates);
    const source: VacancyFitInput = {
      candidateId, vacancyId: cluster.id, description: cluster.descriptionSummary!, requirements: [],
      profileContextHash: currentVacancyFitProfileStamp(candidates, candidateId)!,
      facts: candidates.getSnapshot(candidateId).memory.map((fact) => ({ ...fact, candidateId })),
      gates: {
        role: { status: 'matched', reason: 'confirmed' }, level: { status: 'matched', reason: 'confirmed' },
        region: { status: 'matched', reason: 'confirmed' }, workFormat: { status: 'matched', reason: 'confirmed' }, workAuthorization: { status: 'matched', reason: 'confirmed' },
      },
    };
    const worker = new VacancyMechanicsRuntime(databasePath, Buffer.alloc(32, 8), validate);
    try {
      expect(validate(source)).toBe(true);
      worker.enqueue(source);
      if (change === 'delete-memory') candidates.reviewMemories(candidateId, ['profile-check'], 'delete');
      if (change === 'correct-memory') candidates.changeMemory(candidateId, 'profile-check', { action: 'correct', statement: 'I built Rust services.' });
      // Privacy flag mutation is fixture setup; the actual encrypted candidate store rereads it.
      if (change === 'mark-sensitive') worker.database.prepare('UPDATE memory SET sensitive=1 WHERE candidate_id=? AND id=?').run(candidateId, 'profile-check');
      if (change === 'delete-candidate') candidates.deleteCandidate(candidateId);
      expect(validate(source)).toBe(false);
      const complete = vi.fn().mockRejectedValue(new Error('revoked data must not leave'));
      await worker.runNext({ complete } as unknown as BulkLlmClient);
      // B510: the public vacancy text may still be labelled; candidate data never leaves.
      expect(complete.mock.calls.filter(([request]) => request.dataClass !== 'public')).toEqual([]);
      expect(worker.view(source).result).toBeUndefined();
    } finally { worker.close(); }
  });
});
