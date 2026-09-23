import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from '../appTestHarness';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

/**
 * B251, S2, architecture.md §4, §7: `applyVacancyDecisions` runs strictly
 * after the matched-pool cache read, and a skip is never part of the cache
 * key — folding it in would force a full pool recompute on every click.
 */
function pool(): MatchedVacancyItem[] {
  return ['keep', 'skip-me'].map((suffix) => ({
    cluster: {
      id: `cluster-${suffix}`,
      canonicalTitle: 'Инженер данных',
      canonicalCompany: 'Компания',
      canonicalLocation: 'Москва',
      isRemote: false,
      skills: [],
      descriptionSummary: 'Описание.',
      primaryUrl: `https://example.test/${suffix}`,
      sources: [],
      firstObservedAt: '2026-09-01T00:00:00.000Z',
      lastSeenAt: '2026-09-02T00:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: `cluster-${suffix}`,
      roleMatch: 'target',
      requirements: { matched: 1, total: 2 },
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-09-02T00:00:00.000Z',
    },
  })) as unknown as MatchedVacancyItem[];
}

async function createApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' }, []);

  let calls = 0;
  const engine = {
    getMatchedVacanciesAsync: async () => {
      calls += 1;
      return pool();
    },
    restore: () => ({ clusters: 0, sources: 0 }),
  };

  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    multiSourceVacancyEngine: engine as never,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}`, calls: () => calls };
}

describe('matched-vacancies · decisions applied after the cache read', () => {
  it('hides a skipped vacancy without re-running the matching read', async () => {
    const { app, authorization, calls } = await createApp();

    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/matched-vacancies',
      headers: { authorization },
    });
    const beforeIds: string[] = before.json().data.map((item: { cluster: { id: string } }) => item.cluster.id);
    expect(beforeIds).toContain('cluster-skip-me');
    expect(calls()).toBe(1);

    const skipped = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-skips',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { clusterId: 'cluster-skip-me', reasonId: 'geo-format', origin: 'vacancy_card' },
    });
    expect(skipped.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/matched-vacancies',
      headers: { authorization },
    });
    const afterIds: string[] = after.json().data.map((item: { cluster: { id: string } }) => item.cluster.id);
    expect(afterIds).not.toContain('cluster-skip-me');
    expect(afterIds).toContain('cluster-keep');
    // The skip did not force a recompute of the matched pool (B230/B247).
    expect(calls()).toBe(1);
  });
});
