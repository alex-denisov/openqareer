import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CandidateFootprintAudit,
  CandidateFootprintFinding,
} from '../../shared/candidateFootprint';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateReputationRepository } from '../data/sqliteCandidateReputationRepository';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';

type App = Awaited<ReturnType<typeof buildApp>>;
const cleanups: Array<() => Promise<void> | void> = [];
const RISKS = '/api/v1/candidate/footprint/risks';
const ID = 'a'.repeat(24);
const REQUEST = `/api/v1/candidate/footprint/findings/${ID}/removal-request`;
const RECHECK = `/api/v1/candidate/footprint/findings/${ID}/recheck`;

const recheck = vi.hoisted(() => vi.fn());
vi.mock('../osint/findingRecheck', () => ({ recheckFindingUrl: recheck }));

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

function post(app: App, url: string, token?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: {
      origin: 'http://localhost:3000',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

describe('B382: путь удаления находки', () => {
  beforeEach(() => recheck.mockReset());

  it('без флага B640 оба адреса отвечают как несуществующие, находка не меняется', async () => {
    const { app, repo, people, saveAudit } = await setup();
    const audit = saveAudit('plain', [finding(ID, { kind: 'breach' })]);
    for (const url of [REQUEST, RECHECK]) {
      expect((await post(app, url, 'token-plain')).statusCode).toBe(404);
    }
    expect(recheck).not.toHaveBeenCalled();
    expect(repo.getLatestFootprintAudit(people.plain.candidate!.id)?.findings).toEqual(
      audit.findings,
    );
  });

  it('«Письмо отправлено» записывает дату запроса, повтор её не сдвигает; сводка её показывает', async () => {
    const { app, saveAudit } = await setup();
    saveAudit('flagged', [finding(ID, { kind: 'breach' })]);
    const first = await post(app, REQUEST, 'token-flagged');
    expect(first.statusCode).toBe(200);
    const requestedAt = first.json().data.removal.requestedAt as string;
    expect(Date.parse(requestedAt)).not.toBeNaN();
    const again = await post(app, REQUEST, 'token-flagged');
    expect(again.json().data.removal.requestedAt).toBe(requestedAt);
    const risks = await app.inject({
      method: 'GET',
      url: RISKS,
      headers: { authorization: 'Bearer token-flagged' },
    });
    expect(risks.json().data.items[0].removal).toEqual({ requestedAt });
  });

  it('«Проверить находку» ходит по адресу находки и сохраняет итог; «удалено» снимает её из «стоит убрать»', async () => {
    const { app, saveAudit } = await setup();
    saveAudit('flagged', [finding(ID, { kind: 'breach', url: 'https://board.test/ad/1' })]);
    await post(app, REQUEST, 'token-flagged');
    recheck.mockResolvedValueOnce('removed');
    const response = await post(app, RECHECK, 'token-flagged');
    expect(response.statusCode).toBe(200);
    expect(recheck).toHaveBeenCalledWith('https://board.test/ad/1');
    expect(response.json().data.removal).toMatchObject({ result: 'removed' });
    const risks = await app.inject({
      method: 'GET',
      url: RISKS,
      headers: { authorization: 'Bearer token-flagged' },
    });
    expect(risks.json().data).toMatchObject({ toRemove: 0 });
    expect(risks.json().data.items[0]).toMatchObject({ resolved: true });
  });

  it('без адреса проверять нечего; чужую находку не найти', async () => {
    const { app, saveAudit } = await setup();
    saveAudit('flagged', [finding(ID, { kind: 'breach', url: null as never })]);
    const noUrl = await post(app, RECHECK, 'token-flagged');
    expect(noUrl.statusCode).toBe(409);
    expect(recheck).not.toHaveBeenCalled();
    saveAudit('other', [finding('b'.repeat(24), { kind: 'breach' })]);
    expect((await post(app, REQUEST, 'token-other')).statusCode).toBe(404);
  });
});
