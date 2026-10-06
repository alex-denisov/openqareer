import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { apps, config, noSessions, stores, successProvider } from './appTestHarness';
import type { MatchedVacancyItem } from './vacancies/multiSourceVacancyEngine';

type Salary = { from?: number; to?: number; currency: string } | undefined;

function item(id: string, salary: Salary, isRemote = false): MatchedVacancyItem {
  return {
    cluster: {
      id, canonicalTitle: `Инженер данных ${id}`, canonicalCompany: `Компания ${id}`,
      canonicalLocation: 'Москва', isRemote, skills: [], descriptionSummary: 'Описание. '.repeat(30),
      primaryUrl: `https://example.test/${id}`, sources: [], salary,
      firstObservedAt: '2026-09-01T00:00:00.000Z', lastSeenAt: '2026-09-02T00:00:00.000Z',
      status: 'active', vacanciesCount: 1,
    },
    explanation: {
      clusterId: id, roleMatch: 'target', requirements: { matched: 1, total: 2 },
      matchingPoints: [], missingPoints: [], summary: 'Совпало 1 из 2.', calculatedAt: '2026-09-02T00:00:00.000Z',
    },
  } as unknown as MatchedVacancyItem;
}

const POOL = [
  item('low', { to: 80_000, currency: 'RUB' }),
  item('high', { from: 250_000, to: 300_000, currency: 'RUB' }),
  item('unknown', undefined),
];

async function setup() {
  const candidateStore = new SqliteCandidateStore({ databasePath: ':memory:', encryptionKey: config.dataEncryptionKey });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  candidateStore.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole: 'Инженер данных' }, []);
  const engine = { getMatchedVacanciesAsync: async () => POOL, restore: () => ({ clusters: 0, sources: 0 }) };
  const app = await buildApp({
    config, coachProvider: successProvider, candidateStore, authService: noSessions,
    multiSourceVacancyEngine: engine as never, serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  const headers = { authorization: `Bearer ${candidate.accessToken}` };
  const ids = async () => {
    const response = await app.inject({ url: '/api/v1/candidate/matched-vacancies', headers });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    return { ids: body.data.map((v: MatchedVacancyItem) => v.cluster.id).sort(), total: body.meta.total as number };
  };
  return { app, headers, ids, candidateStore, candidateId: candidate.id };
}

describe('B384: профиль ограничений как жёсткий фильтр подборки на сервере', () => {
  it('без профиля ответ прежний', async () => {
    const { ids } = await setup();
    expect(await ids()).toEqual({ ids: ['high', 'low', 'unknown'], total: 3 });
  });

  it('зарплатный пол исключает вакансии ниже порога, неизвестная зарплата остаётся', async () => {
    const { app, headers, ids } = await setup();
    const put = await app.inject({
      method: 'PUT', url: '/api/v1/candidate/decision-profile', headers,
      payload: { salaryFloor: 100_000, salaryCurrency: 'RUB', citizenship: ['RU'] },
    });
    expect(put.statusCode).toBe(200);
    expect(await ids()).toEqual({ ids: ['high', 'unknown'], total: 2 });
  });

  it('формат работы «только удалёнка» исключает офисные вакансии', async () => {
    const { app, headers, ids } = await setup();
    await app.inject({ method: 'PUT', url: '/api/v1/candidate/decision-profile', headers,
      payload: { workFormats: ['remote_home'] } });
    expect((await ids()).total).toBe(0);
  });

  it('отклоняет неверный профиль и не отдаёт чужой', async () => {
    const { app, headers } = await setup();
    const bad = await app.inject({ method: 'PUT', url: '/api/v1/candidate/decision-profile', headers,
      payload: { salaryFloor: -1 } });
    expect(bad.statusCode).toBe(400);
    const read = await app.inject({ url: '/api/v1/candidate/decision-profile', headers });
    expect(read.json().data).toBeNull();
  });

  it('поля профиля отсутствуют в публичном каталоге', async () => {
    const { app, headers } = await setup();
    await app.inject({ method: 'PUT', url: '/api/v1/candidate/decision-profile', headers,
      payload: { salaryFloor: 777_777, citizenship: ['Zanzibaria'], hasFamily: true } });
    const catalog = await app.inject({ method: 'GET', url: '/vacancies' });
    expect(catalog.body).not.toContain('777777');
    expect(catalog.body).not.toContain('Zanzibaria');
    expect(catalog.body).not.toContain('salaryFloor');
  });
});
