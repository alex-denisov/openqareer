import { afterEach, describe, expect, it } from 'vitest';
import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
} from '../../shared/candidateFootprint';
import type { CandidateReputationAudit } from '../../shared/candidateReputation';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const RISKS = '/api/v1/candidate/footprint/risks';

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function finding(id: string, patch: Partial<CandidateFootprintFinding>): CandidateFootprintFinding {
  return {
    id,
    adapter: 'sherlock',
    kind: 'profile',
    url: `https://site.test/${id}`,
    title: 'GitHub',
    detail: 'Открытый профиль',
    match: 'confirmed_self',
    automatedMatch: 'likely_self',
    review: 'confirmed_self',
    observedAt: '2026-11-11T09:00:00.000Z',
    sources: ['sherlock', 'maigret'],
    receipt: { method: 'sherlock', source: 'maigret', query: 'secret-query' },
    receipts: [{ method: 'sherlock', source: 'maigret', query: 'secret-query' }],
    ...patch,
  };
}

async function setup() {
  const config = { ...baseConfig, cabinetB640Usernames: ['flagged.test', 'other.test'] };
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
  return { app, repo, people, saveAudit };
}

function get(app: App, url: string, token?: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('GET /candidate/footprint/risks', () => {
  it('без флага B640 отвечает как несуществующий адрес; прежний маршрут следа не меняется', async () => {
    const { app, saveAudit } = await setup();
    const audit = saveAudit('plain', [finding('a'.repeat(24), { kind: 'breach' })]);
    const missing = await get(app, '/api/v1/candidate/no-such-route', 'token-plain');
    for (const token of ['token-plain', undefined]) {
      const response = await get(app, RISKS, token);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe(missing.json().error.code);
    }
    const old = await get(app, '/api/v1/candidate/footprint', 'token-plain');
    expect(old.statusCode).toBe(200);
    expect(old.json().data.audit.findings).toEqual(audit.findings);
  });

  it('пока проверки не было — честное «не проверяли», после пустой проверки — «Ничего рискового»', async () => {
    const { app, saveAudit } = await setup();
    const before = (await get(app, RISKS, 'token-flagged')).json().data;
    expect(before).toMatchObject({ state: 'not_checked', headline: null, total: 0 });
    saveAudit('flagged', []);
    const after = await get(app, RISKS, 'token-flagged');
    expect(after.headers['cache-control']).toBe('no-store');
    expect(after.json().data).toMatchObject({
      state: 'ready',
      headline: 'Ничего рискового',
      toRemove: 0,
    });
  });

  it('отдаёт счётчики по пяти категориям, итог и находки без инструментов и запросов', async () => {
    const { app, repo, people, saveAudit } = await setup();
    saveAudit('flagged', [
      finding('a'.repeat(24), { kind: 'breach', url: null, title: 'Почта в утечке (HIBP)' }),
      finding('b'.repeat(24), { kind: 'profile', staleAccount: true, title: 'Мой Круг' }),
      finding('c'.repeat(24), {
        url: 'https://conf.site.test/speakers',
        kind: 'mention',
        title: 'Сайт конференции',
      }),
    ]);
    const reputation: CandidateReputationAudit = {
      id: 'rep-1',
      candidateId: people.flagged.candidate!.id,
      status: 'completed',
      overallStatus: 'attention',
      score: 70,
      consistencyDiscrepancies: [
        {
          id: 'd1',
          field: 'Должность',
          candidateValue: 'Руководитель группы разработки',
          externalValue: 'тимлид',
          externalSource: 'https://conf.site.test/speakers',
          severity: 'warning',
          suggestion: 'Попросите организаторов исправить должность.',
        },
      ],
      reputationRisks: [],
      consentAction: 'digital_footprint',
      startedAt: '2026-11-11T08:00:00.000Z',
      completedAt: '2026-11-11T09:00:00.000Z',
    };
    repo.saveAudit(reputation);

    const response = await get(app, RISKS, 'token-flagged');
    const data = response.json().data;
    expect(data.headline).toBe('4 находки, 3 стоит убрать');
    expect(
      data.categories.map((category: { id: string; count: number }) => [
        category.id,
        category.count,
      ]),
    ).toEqual([
      ['personal_data', 1],
      ['needs_check', 0],
      ['resume_mismatch', 1],
      ['stale_profile', 1],
      ['useful_evidence', 1],
    ]);
    const mismatch = data.items.find(
      (item: { category: string }) => item.category === 'resume_mismatch',
    );
    expect(mismatch.findingId).toBe('c'.repeat(24));
    const body = response.body.toLowerCase();
    for (const word of [
      'sherlock',
      'maigret',
      'hibp',
      'secret-query',
      'receipt',
      'adapter',
      'score',
    ]) {
      expect(body, word).not.toContain(word);
    }
  });

  it('чужие находки не видны', async () => {
    const { app, saveAudit } = await setup();
    saveAudit('flagged', [finding('a'.repeat(24), { kind: 'breach' })]);
    expect((await get(app, RISKS, 'token-other')).json().data).toMatchObject({
      state: 'not_checked',
      total: 0,
    });
  });

  it('чтение сводки ничего не меняет в сохранённой проверке', async () => {
    const { app, repo, people, saveAudit } = await setup();
    saveAudit('flagged', [finding('a'.repeat(24), { kind: 'breach' })]);
    const before = JSON.stringify(repo.getLatestFootprintAudit(people.flagged.candidate!.id));
    await get(app, RISKS, 'token-flagged');
    await get(app, RISKS, 'token-flagged');
    expect(JSON.stringify(repo.getLatestFootprintAudit(people.flagged.candidate!.id))).toBe(before);
  });
});
