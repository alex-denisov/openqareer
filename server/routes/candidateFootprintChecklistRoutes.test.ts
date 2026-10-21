import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config, noSessions, successProvider } from '../appTestHarness';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
} from '../../shared/candidateFootprint';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function finding(id: string, patch: Partial<CandidateFootprintFinding>): CandidateFootprintFinding {
  return {
    id,
    adapter: 'exa',
    kind: 'profile',
    url: null,
    title: 'Доклад о платёжной архитектуре, 2023',
    detail: 'Совпадение по имени',
    match: 'confirmed_self',
    automatedMatch: 'unknown',
    review: 'confirmed_self',
    observedAt: '2026-10-06T09:00:00.000Z',
    sources: ['exa'],
    receipt: { method: 'm', source: 's', query: 'q' },
    receipts: [],
    ...patch,
  };
}

const LEAK = 'a'.repeat(24);
const TALK = 'b'.repeat(24);
const OLD = 'c'.repeat(24);

async function setup() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const repo = new SqliteCandidateReputationRepository({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const audit: CandidateFootprintAudit = {
    id: 'audit-1',
    candidateId: candidate.id,
    state: 'completed',
    selectedQueryIds: [],
    adapterStatuses: [],
    findings: [
      finding(LEAK, { kind: 'breach', title: 'Почта в утечке' }),
      finding(TALK, { kind: 'mention' }),
      finding(OLD, { staleAccount: true, title: 'Старый аккаунт' }),
    ],
    ownershipConfirmedAt: '2026-10-05T09:00:00.000Z',
    startedAt: '2026-10-06T09:00:00.000Z',
    completedAt: '2026-10-06T09:12:00.000Z',
  };
  repo.saveFootprintAudit(audit);
  const app = await buildApp({
    config,
    candidateStore,
    authService: noSessions,
    coachProvider: successProvider,
    candidateReputationRepo: repo,
    serveStatic: false,
  });
  cleanups.push(async () => {
    await app.close();
    candidateStore.close();
    repo.close();
  });
  const headers = {
    authorization: `Bearer ${candidate.accessToken}`,
    origin: 'http://localhost:3000',
  };
  return { app, headers, candidateStore, candidate };
}

describe('footprint checklist routes (B544)', () => {
  it('stores «пароль сменён» on a leak and rejects a mark that does not fit the finding', async () => {
    const { app, headers } = await setup();
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/footprint/findings/${LEAK}/checklist`,
      headers,
      payload: { mark: 'password_changed' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.audit.findings[0].checklistMark).toBe('password_changed');

    const wrong = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/footprint/findings/${TALK}/checklist`,
      headers,
      payload: { mark: 'account_closed' },
    });
    expect(wrong.statusCode).toBe(409);

    const old = await app.inject({
      method: 'PATCH',
      url: `/api/v1/candidate/footprint/findings/${OLD}/checklist`,
      headers,
      payload: { mark: 'account_kept' },
    });
    expect(old.json().data.audit.findings[2].checklistMark).toBe('account_kept');
  });

  it('adds a confirmed artifact to the profile as a fact from the digital footprint', async () => {
    const { app, headers, candidateStore, candidate } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/footprint/findings/${TALK}/profile-fact`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const stored = response.json().data.audit.findings[1] as CandidateFootprintFinding;
    expect(stored.checklistMark).toBe('added_to_profile');
    const memory = candidateStore.getSnapshot(candidate.id).memory;
    const fact = memory.find((entry) => entry.id === stored.profileFactId);
    expect(fact?.statement).toBe('Доклад о платёжной архитектуре, 2023');

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/footprint/findings/${TALK}/profile-fact`,
      headers,
    });
    expect(again.statusCode).toBe(409);
  });

  it('refuses to add a finding that is not a professional artifact', async () => {
    const { app, headers } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/footprint/findings/${LEAK}/profile-fact`,
      headers,
    });
    expect(response.statusCode).toBe(409);
  });
});
