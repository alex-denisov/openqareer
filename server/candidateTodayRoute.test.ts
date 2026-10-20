import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';
import type { MatchedVacancyItem } from './vacancies/multiSourceVacancyEngine';
import { SqliteTitleParseStore } from './vacancies/titleParse/sqliteTitleParseStore';
import { normalizeTitleKey } from './vacancies/titleParse/normalizeTitleKey';

/** `GET /today` (B251, S4, architecture.md §4, §57, §97). */
function pool(
  roleMatches: readonly ('target' | 'partial' | 'none')[] = ['target'],
  remoteFlags: readonly boolean[] = [],
): MatchedVacancyItem[] {
  return roleMatches.map((roleMatch, index) => {
    const clusterId = `cluster-${index + 1}`;
    return {
      cluster: {
        id: clusterId,
        canonicalTitle: `Инженер данных ${index + 1}`,
        canonicalCompany: 'Компания',
        canonicalLocation: 'Москва',
        isRemote: remoteFlags[index] ?? false,
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
  remoteFlags?: readonly boolean[];
  experienceTitle?: string;
  titleParseStore?: SqliteTitleParseStore;
  remoteOnly?: boolean;
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
  if (options?.remoteOnly) {
    candidateStore.saveCandidateWorkspace(candidate.id, {
      resumeText: '',
      resumeSource: 'text',
      targetDirection: 'Инженер данных',
      regions: ['ru'],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
      campaign: {
        roles: ['Инженер данных'],
        regions: ['ru'],
        remoteOnly: true,
        revision: 1,
        updatedAt: '2026-09-24T00:00:00.000Z',
      },
    });
  }

  const engine = {
    getMatchedVacanciesAsync: async () => pool(options?.roleMatches, options?.remoteFlags),
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
  return {
    app,
    authorization: `Bearer ${candidate.accessToken}`,
    candidateStore,
    candidateId: candidate.id,
  };
}

const TODAY_URL = '/api/v1/candidate/today';

describe('GET /candidate/today', () => {
  it('names the connected sources so «Сегодня» needs no connections request (B534)', async () => {
    const { app, authorization, candidateStore, candidateId } = await createApp();
    const empty = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });
    expect(empty.json().data.connectedSources).toEqual([]);

    candidateStore.commitResumeImport(candidateId, {
      evidence: {
        sourceLabel: 'Импорт: резюме hh.ru',
        entries: [
          {
            memoryId: 'native-hh-result-1',
            domain: 'outcome',
            statement: 'Запустил продукт и сократил срок релиза.',
          },
        ],
      },
      draft: EMPTY_RESUME_DRAFT,
      sourceReceipt: {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        sourceUrl: 'https://hh.ru/resume/synthetic-source-731',
        capturedAt: '2026-08-23T12:00:00.000Z',
        importDigest: 'a'.repeat(64),
      },
    });
    const connected = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });
    expect(connected.json().data.connectedSources).toEqual(['hh']);
  });

  it('asks to confirm the current place team size only when favorites name one (B540)', async () => {
    const { app, authorization, candidateStore, candidateId } = await createApp();
    candidateStore.saveResumeDraft(
      candidateId,
      {
        ...EMPTY_RESUME_DRAFT,
        experience: [
          {
            id: 'exp-fintech',
            chronologyMemoryId: 'chronology-fintech',
            title: 'Head of Engineering',
            employer: 'Финтех Лаб',
            current: true,
            bulletMemoryIds: [],
          },
        ],
      },
      [],
    );
    const favorite = (index: number, notes: string | null) => {
      const created = candidateStore.createApplication(candidateId, {
        manualVacancy: {
          title: 'CTO',
          company: `Компания ${index}`,
          source: 'other',
          url: `https://example.test/${index}`,
        },
        stage: 'saved',
      });
      if (notes) {
        candidateStore.patchApplication(candidateId, created.id, {
          expectedVersion: created.version,
          notes,
        });
      }
    };
    favorite(1, 'Опыт от 7 лет');
    const silent = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });
    expect(silent.json().data.teamSizeDecision).toBeUndefined();

    favorite(2, 'Управление командой от 50 человек');
    favorite(3, null);
    const asked = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });
    expect(asked.json().data.teamSizeDecision).toMatchObject({
      kind: 'team_size',
      experienceId: 'exp-fintech',
      employer: 'Финтех Лаб',
      favoritesTotal: 3,
      favoritesAsking: 1,
      minTeamSize: 50,
    });
  });

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

  it('returns only persisted receipt and scheduled-interview counts for the server 30-day window', async () => {
    const { app, authorization, candidateStore, candidateId } = await createApp();
    const oldStageDate = new Date(Date.now() - 41 * 86_400_000).toISOString();
    const application = candidateStore.createApplication(candidateId, {
      stage: 'applied',
      occurredAt: oldStageDate,
      vacancy: { title: 'Инженер данных', company: 'FinCloud', url: '', source: '' },
    });
    candidateStore.patchApplication(candidateId, application.id, {
      expectedVersion: application.version,
      occurredAt: oldStageDate,
      deliveryReceipt: { kind: 'auto_reply', value: 'Подтверждение отправки' },
    });
    candidateStore.createApplicationInterview(candidateId, application.id, {
      round: 1,
      scheduledAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    });
    candidateStore.createApplicationInterview(candidateId, application.id, {
      round: 2,
      scheduledAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    });

    const response = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const momentum = response.json().data.momentum;
    expect(momentum.windows['30d'].applied).toBe(1);
    expect(momentum.windows['30d'].interviews).toBe(1);
    expect(momentum.evidence['30d'].endAt).toBe(momentum.calculatedAt);
    expect(
      Date.parse(momentum.evidence['30d'].endAt) - Date.parse(momentum.evidence['30d'].startAt),
    ).toBe(30 * 86_400_000);
    expect(momentum.evidence['30d'].applied).toMatchObject({
      source: 'application_events.recorded_at',
      sampleSize: 1,
    });
    expect(momentum.evidence['30d'].interviews).toMatchObject({
      source: 'candidate_interview_schedules.scheduled_at',
      sampleSize: 1,
    });

    const otherCandidate = candidateStore.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const isolated = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization: `Bearer ${otherCandidate.accessToken}` },
    });
    expect(isolated.statusCode).toBe(200);
    expect(isolated.json().data.momentum.windows['30d'].applied).toBe(0);
    expect(isolated.json().data.momentum.windows['30d'].interviews).toBe(0);
  });

  it("excludes vacancies without a role match from today's new-vacancy digest and queue", async () => {
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

  it('returns 200 with an empty, non-pending digest when the pool has nothing to match', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.vacanciesPending).toBe(false);
    expect(body.digest.newVacancies).toBe(0);
  });

  it('builds a non-empty queue on the very first visit, without a prior Vacancies visit (B251, C55)', async () => {
    const { app, authorization } = await createApp({ withMatchingEngine: true });

    // No warm-up request to /matched-vacancies before this one: `/today`
    // must read the matched pool itself instead of relying on a snapshot
    // left behind by the candidate's last visit to «Вакансии».
    const response = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.vacanciesPending).toBe(false);
    expect(body.digest.newVacancies).toBe(1);
    expect(body.queue.some((item: { kind: string }) => item.kind === 'new_vacancy')).toBe(true);
  });

  it('applies the explicit remote-only campaign choice to Vacancies and Today', async () => {
    const { app, authorization } = await createApp({
      withMatchingEngine: true,
      roleMatches: ['target', 'target'],
      remoteFlags: [false, true],
      remoteOnly: true,
    });

    const vacancies = await app.inject({
      url: '/api/v1/candidate/matched-vacancies',
      headers: { authorization },
    });
    expect(vacancies.statusCode).toBe(200);
    expect(vacancies.json().data).toHaveLength(1);
    expect(vacancies.json().data[0].cluster.isRemote).toBe(true);
    expect(vacancies.json().meta.campaign.remoteOnly).toBe(true);

    const today = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers: { authorization },
    });
    expect(today.statusCode).toBe(200);
    expect(today.json().data.digest.newVacancies).toBe(1);
    expect(today.json().data.queue.map((item: { clusterId?: string }) => item.clusterId)).toEqual([
      'cluster-2',
    ]);
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

  it('returns five items first and the real remainder for the same queue revision', async () => {
    const roleMatches = Array.from({ length: 12 }, () => 'target' as const);
    const { app, authorization } = await createApp({ withMatchingEngine: true, roleMatches });
    const headers = { authorization };
    const first = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow`,
      headers,
    });

    expect(first.statusCode, first.body).toBe(200);
    const firstPage = first.json().data;
    expect(firstPage.queue).toHaveLength(5);
    expect(firstPage.queueTotal).toBe(12);
    expect(firstPage.queueRevision).toMatch(/^[a-f0-9]{64}$/u);

    const remaining = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow&queueOffset=5&queueRevision=${firstPage.queueRevision}`,
      headers,
    });
    expect(remaining.statusCode, remaining.body).toBe(200);
    expect(remaining.json().data.queue).toHaveLength(7);
    expect(
      [...firstPage.queue, ...remaining.json().data.queue].map(
        (item: { clusterId?: string }) => item.clusterId,
      ),
    ).toEqual(Array.from({ length: 12 }, (_, index) => `cluster-${index + 1}`));

    const stale = await app.inject({
      url: `${TODAY_URL}?tz=Europe/Moscow&queueOffset=5&queueRevision=${'0'.repeat(64)}`,
      headers,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('today_queue_changed');
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
