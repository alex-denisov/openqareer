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
import { toPublicFootprint } from './footprintPublicView';

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
    // B740: прежний маршрут отдаёт те же находки, но шагами, без инструментов и квитанций.
    expect(old.json().data.audit.findings).toEqual(toPublicFootprint(audit.findings));
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

describe('PATCH /candidate/footprint/mismatches/:id (B645 p02 «Это не проблема»)', () => {
  const MISMATCH = '/api/v1/candidate/footprint/mismatches';

  function reputation(candidateId: string, discrepancyId: string): CandidateReputationAudit {
    return {
      id: `rep-${discrepancyId}`,
      candidateId,
      status: 'completed',
      overallStatus: 'attention',
      score: 70,
      consistencyDiscrepancies: [
        {
          id: discrepancyId,
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
  }

  function patch(app: App, id: string, review: string, token = 'token-flagged') {
    return app.inject({
      method: 'PATCH',
      url: `${MISMATCH}/${encodeURIComponent(id)}`,
      headers: { authorization: `Bearer ${token}`, origin: 'http://localhost:3000' },
      payload: { review },
    });
  }

  const mismatches = async (app: App) =>
    (await get(app, RISKS, 'token-flagged'))
      .json()
      .data.items.filter((item: { category: string }) => item.category === 'resume_mismatch');

  it('отметка сохраняется и убирает расхождение; отмена возвращает; переживает новую проверку резюме', async () => {
    const { app, repo, people, saveAudit } = await setup();
    saveAudit('flagged', []);
    repo.saveAudit(reputation(people.flagged.candidate!.id, 'd1'));
    const [item] = await mismatches(app);
    expect(item.id).toBe('mismatch:d1');

    const hidden = await patch(app, item.id, 'hidden');
    expect(hidden.statusCode).toBe(200);
    expect(await mismatches(app)).toEqual([]);
    // Новая проверка резюме даёт то же расхождение под другим id — отметка остаётся.
    repo.saveAudit({
      ...reputation(people.flagged.candidate!.id, 'd2'),
      startedAt: '2026-11-12T08:00:00.000Z',
      completedAt: '2026-11-12T09:00:00.000Z',
    });
    expect(await mismatches(app)).toEqual([]);

    const undone = await patch(app, 'mismatch:d2', 'unreviewed');
    expect(undone.statusCode).toBe(200);
    expect((await mismatches(app)).map((entry: { id: string }) => entry.id)).toEqual([
      'mismatch:d2',
    ]);
  });

  it('чужое или неизвестное расхождение — 404; без проверки следа — 409; неверная отметка — 400', async () => {
    const { app, repo, people, saveAudit } = await setup();
    repo.saveAudit(reputation(people.flagged.candidate!.id, 'd1'));
    expect((await patch(app, 'mismatch:d1', 'hidden')).statusCode).toBe(409);
    saveAudit('flagged', []);
    saveAudit('other', []);
    expect((await patch(app, 'mismatch:d1', 'hidden', 'token-other')).statusCode).toBe(404);
    expect((await patch(app, 'mismatch:zz', 'hidden')).statusCode).toBe(404);
    expect((await patch(app, 'mismatch:d1', 'not_self')).statusCode).toBe(400);
  });
});
