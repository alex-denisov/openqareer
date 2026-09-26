import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';
import type { MatchedVacancyItem } from './vacancies/multiSourceVacancyEngine';
import { SqliteTitleParseStore } from './vacancies/titleParse/sqliteTitleParseStore';
import { normalizeTitleKey } from './vacancies/titleParse/normalizeTitleKey';

/** `GET /today` (B251, S4, architecture.md §4, §57, §97). */
function pool(roleMatches: readonly ('target' | 'partial' | 'none')[] = ['target']): MatchedVacancyItem[] {
  return roleMatches.map((roleMatch, index) => {
    const clusterId = `cluster-${index + 1}`;
    return {
      cluster: {
        id: clusterId,
        canonicalTitle: `Инженер данных ${index + 1}`,
        canonicalCompany: 'Компания',
        canonicalLocation: 'Москва',
        isRemote: false,
        skills: [],
        descriptionSummary: 'Описание вакансии. '.repeat(20),
        primaryUrl: `https://example.test/${index + 1}`,
        sources: [],
        firstObservedAt: '2026-09-24T00:00:00.000Z',
        lastSeenAt: '2026-09-24T00:00:00.000Z',
        status: 'active',
        vacanciesCount: 1,
      },
      explanation: {
        clusterId,
        roleMatch,
        requirements: { matched: 1, total: 2 },
        matchingPoints: ['Подтверждённый навык: SQL'],
        missingPoints: ['Airflow'],
        summary: 'Совпало 1 из 2 требований вакансии.',
        calculatedAt: '2026-09-24T00:00:00.000Z',
      },
    };
  }) as unknown as MatchedVacancyItem[];
}

async function createApp(options?: {
  withMatchingEngine?: boolean;
  roleMatches?: readonly ('target' | 'partial' | 'none')[];
  experienceTitle?: string;
  titleParseStore?: SqliteTitleParseStore;
}) {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveResumeDraft(
    candidate.id,
    {
      ...EMPTY_RESUME_DRAFT,
      targetRole: 'Инженер данных',
      experience: options?.experienceTitle
        ? [
            {
              id: 'experience-1',
              chronologyMemoryId: 'chronology-1',
              title: options.experienceTitle,
              current: true,
              bulletMemoryIds: [],
            },
          ]
        : [],
    },
    [],
  );

  const engine = {
    getMatchedVacanciesAsync: async () => pool(options?.roleMatches),
    isKnownVacancyGone: () => false,
    restore: () => ({ clusters: 0, sources: 0 }),
  };

  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    multiSourceVacancyEngine: options?.withMatchingEngine ? (engine as never) : undefined,
    titleParseStore: options?.titleParseStore,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

const TODAY_URL = '/api/v1/candidate/today';

describe('GET /candidate/today', () => {
  it('returns 200 with a populated digest once the matched pool is warm', async () => {
    const { app, authorization } = await createApp({ withMatchingEngine: true });

    // Warms the shared matched-pool snapshot the same way the cabinet does,
    // so `/today` finds a hot cache instead of `vacanciesPending`.
    await app.inject({
      url: '/api/v1/candidate/matched-vacancies',
      headers: { authorization },
    });

    const response = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.vacanciesPending).toBe(false);
    expect(body.digest.newVacancies).toBe(1);
  });

  it('excludes vacancies without a role match from today\'s new-vacancy digest and queue', async () => {
    const { app, authorization } = await createApp({
      withMatchingEngine: true,
      roleMatches: ['target', 'partial', 'none'],
    });

    await app.inject({
      url: '/api/v1/candidate/matched-vacancies',
      headers: { authorization },
    });
    const response = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.digest.newVacancies).toBe(2);
    const newVacancyIds = body.queue
      .filter((item: { kind: string }) => item.kind === 'new_vacancy')
      .map((item: { clusterId?: string }) => item.clusterId);
    expect(newVacancyIds).toHaveLength(2);
    expect(newVacancyIds).not.toContain('cluster-3');
    expect(body.sinceLastVisit.items).toContain('2 новые вакансии по роли Инженер данных');
  });

  it('returns 200 with vacanciesPending on a cold matching cache', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.vacanciesPending).toBe(true);
    expect(body.digest.newVacancies).toBe(0);
  });

  // The app maps every Zod validation failure to 422 (`runtime.ts`), the
  // same single error shape every other route uses — not a one-off 400.
  it('rejects an invalid tz', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      url: `${TODAY_URL}?tz=Not/AZone`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(422);
  });

  it('requires an authenticated candidate', async () => {
    const { app } = await createApp();

    const response = await app.inject({ url: `${TODAY_URL}?tz=Europe/Moscow` });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /candidate/matched-vacancies level explanation', () => {
  it('uses the stored title parse to classify a vacancy when title rules cannot', async () => {
    const titleParseStore = new SqliteTitleParseStore({ databasePath: ':memory:' });
    titleParseStore.insertIfMissing({
      titleKey: normalizeTitleKey('Инженер данных 1'),
      sampleTitle: 'Инженер данных 1',
      functions: [],
      levelRank: 0,
      roleLabel: null,
      parsedBy: 'rules',
      model: null,
      taxonomyVersion: 1,
      priority: 0,
    });
    expect(titleParseStore.getByKey(normalizeTitleKey('Инженер данных 1'))?.levelRank).toBe(0);
    const getByKey = vi.spyOn(titleParseStore, 'getByKey');
    const { app, authorization } = await createApp({
      withMatchingEngine: true,
      experienceTitle: 'VP Technology Operations',
      titleParseStore,
    });

    const response = await app.inject({
      url: '/api/v1/candidate/matched-vacancies',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().meta.candidateLevel).toBe('vp');
    expect(getByKey).toHaveBeenCalledWith('инженер данных');
    expect(response.json().data[0].explanation.levelMatch).toBe('below');
  });
});
