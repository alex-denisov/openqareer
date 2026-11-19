import { afterEach, describe, expect, it } from 'vitest';
import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
} from '../../shared/candidateFootprint';
import type { ResumeDraft } from '../domain/resumeDraft';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const PLAN = '/api/v1/candidate/footprint/plan';

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(youtubeApiKey?: string) {
  const config = {
    ...baseConfig,
    cabinetB640Usernames: ['flagged.test', 'other.test'],
    ...(youtubeApiKey ? { youtubeApiKey } : {}),
  };
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const repo = new SqliteCandidateReputationRepository({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const principal = (username: string): AuthPrincipal => ({
    userId: `user-${username}`,
    username,
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }),
  });
  const people = {
    flagged: principal('flagged.test'),
    other: principal('other.test'),
    plain: principal('plain.test'),
  };
  const sessions = new Map(Object.entries(people).map(([name, value]) => [`token-${name}`, value]));
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token: string) => sessions.get(token) ?? null,
  };
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    coachProvider: {} as never,
    candidateReputationRepo: repo,
    serveStatic: false,
  });
  cleanups.push(
    () => candidateStore.close(),
    () => app.close(),
  );
  const saveAudit = (who: keyof typeof people, findings: CandidateFootprintFinding[]) => {
    const audit: CandidateFootprintAudit = {
      id: `audit-${who}`,
      candidateId: people[who].candidate!.id,
      state: 'completed',
      selectedQueryIds: [],
      adapterStatuses: [],
      findings,
      ownershipConfirmedAt: '2026-11-10T09:00:00.000Z',
      startedAt: '2026-11-11T08:00:00.000Z',
      completedAt: '2026-11-11T09:30:00.000Z',
    };
    repo.saveFootprintAudit(audit);
    return audit;
  };
  const draft = {
    candidate: {
      fullName: 'Мария Соколова',
      contact: {
        links: ['https://www.youtube.com/@msokolova', 'https://www.instagram.com/msokolova'],
      },
    },
    experience: [],
  } as unknown as ResumeDraft;
  for (const person of Object.values(people)) {
    candidateStore.saveResumeDraft(person.candidate!.id, draft, []);
  }
  return { app, repo, people, saveAudit };
}

async function plan(app: App, token: string) {
  const response = await app.inject({
    method: 'GET',
    url: PLAN,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as {
    plan: Array<{ adapterId: string; preview: string; available: boolean }>;
    sourceAvailability: Record<string, boolean>;
  };
}

describe('B668: канал YouTube в «Данных для поиска»', () => {
  it('без флага B640 план и готовность источников прежние: YouTube нет', async () => {
    const { app } = await setup('fixture-key');
    const data = await plan(app, 'token-plain');
    expect(data.plan.some((item) => item.adapterId === 'youtube')).toBe(false);
    expect(Object.keys(data.sourceAvailability)).toEqual([
      'sherlock', 'maigret', 'hibp', 'wayback', 'exa',
    ]);
  });

  it('с флагом и ключом — пункт канала YouTube доступен; Instagram остаётся ссылкой', async () => {
    const { app } = await setup('fixture-key');
    const data = await plan(app, 'token-flagged');
    const youtube = data.plan.filter((item) => item.adapterId === 'youtube');
    expect(youtube).toEqual([
      expect.objectContaining({
        preview: 'Проверить архив публичной страницы https://www.youtube.com/@msokolova',
        available: true,
      }),
    ]);
    expect(data.sourceAvailability.youtube).toBe(true);
    expect(data.plan.some((item) => item.adapterId === 'youtube' && item.preview.includes('instagram'))).toBe(false);
  });

  it('с флагом без ключа — пункт есть, но не доступен (источник не подключён)', async () => {
    const { app } = await setup();
    const data = await plan(app, 'token-flagged');
    expect(data.plan.find((item) => item.adapterId === 'youtube')).toMatchObject({ available: false });
    expect(data.sourceAvailability.youtube).toBe(false);
  });
});
