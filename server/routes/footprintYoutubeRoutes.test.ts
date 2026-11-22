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
      'sherlock',
      'maigret',
      'hibp',
      'wayback',
      'exa',
    ]);
  });

  it('с флагом и ключом — у ссылки YouTube есть доступная проверка канала; Instagram остаётся ссылкой', async () => {
    const { app } = await setup('fixture-key');
    const data = await plan(app, 'token-flagged');
    // Архив страницы и проверка канала — одна строка на ссылку (B668: без повторов).
    const youtube = data.plan.filter((item) => item.preview.includes('youtube.com'));
    expect(youtube.map((item) => item.available)).toEqual([true]);
    const previews = data.plan.map((item) => item.preview);
    expect(new Set(previews).size).toBe(previews.length);
    expect(data.plan.filter((item) => item.preview.includes('instagram'))).toHaveLength(1);
  });

  it('с флагом без ключа — строка ссылки одна и доступна: архив страницы, без проверки канала', async () => {
    const { app } = await setup();
    const data = await plan(app, 'token-flagged');
    const youtube = data.plan.filter((item) => item.preview.includes('youtube.com'));
    // Строка остаётся доступной: архив страницы работает и без ключа.
    expect(youtube.map((item) => item.available)).toEqual([true]);
  });
});

/** B740: экран B640 не называет инструменты поиска — ни в тексте, ни в ответе. */
describe('B740: ответы цифрового следа без названий инструментов', () => {
  const TOOLS =
    /sherlock|maigret|hibp|wayback|\bexa\b|exiftool|youtube_api|adapterId|sourceAvailability/iu;

  it('с флагом план, аудит и находки без названий инструментов', async () => {
    const { app, saveAudit } = await setup('fixture-key');
    saveAudit('flagged', [
      {
        id: 'f-1',
        adapter: 'maigret',
        kind: 'profile',
        url: 'https://github.com/msokolova',
        title: 'GitHub',
        detail: 'Открытая страница найдена по нику.',
        match: 'likely_self',
        observedAt: '2026-11-11T09:00:00.000Z',
        receipt: { method: 'maigret', source: 'maigret', query: 'msokolova' },
        sources: ['sherlock', 'maigret'],
        receipts: [{ method: 'sherlock', source: 'sherlock', query: 'msokolova' }],
        automatedMatch: 'likely_self',
        review: 'unreviewed',
      },
    ]);
    const response = await app.inject({
      method: 'GET',
      url: PLAN,
      headers: { authorization: 'Bearer token-flagged' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toMatch(TOOLS);
    const data = response.json().data;
    expect(data.plan.length).toBeGreaterThan(0);
    expect(data.audit.findings[0]).toMatchObject({ id: 'f-1', title: 'GitHub' });
  });

  it('без флага ответ прежний', async () => {
    const { app } = await setup('fixture-key');
    const data = await plan(app, 'token-plain');
    expect(data.plan.every((item) => typeof item.adapterId === 'string')).toBe(true);
    expect(data.sourceAvailability).toBeDefined();
  });
});
