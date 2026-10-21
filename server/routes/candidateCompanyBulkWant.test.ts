import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { SqliteCandidateCompanyWantsRepository } from '../data/sqliteCandidateCompanyWantsRepository';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import {
  candidateAuthorization,
  config,
  createApp,
  stores,
  successProvider,
} from '../appTestHarness';
import { candidateCompanyKey } from '../domain/candidateCompanies';

const opened: Array<{ db: DatabaseSync; repo: SqliteCandidateCompanyWantsRepository }> = [];
afterEach(() => {
  for (const { db, repo } of opened.splice(0)) {
    repo.close();
    db.close();
  }
});

function vacancy(id: string, company: string): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: 'Руководитель платформы',
      canonicalCompany: company,
      canonicalLocation: 'Москва',
      isRemote: false,
      skills: [],
      descriptionSummary: 'Описание вакансии.',
      primaryUrl: `https://hh.ru/vacancy/${id}`,
      sources: [],
      firstObservedAt: '2026-10-08T10:00:00.000Z',
      lastSeenAt: '2026-10-08T10:00:00.000Z',
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: {
      clusterId: id,
      roleMatch: 'target',
      requirements: { matched: 1, total: 2 },
      matchingPoints: [],
      missingPoints: [],
      summary: '',
      calculatedAt: '2026-10-08T10:00:00.000Z',
    },
  } as unknown as MatchedVacancyItem;
}

async function setup(companies: readonly string[]) {
  const db = new DatabaseSync(':memory:');
  const wants = new SqliteCandidateCompanyWantsRepository(db, config.dataEncryptionKey);
  opened.push({ db, repo: wants });
  const items = companies.map((name, index) => vacancy(`cluster-${index}`, name));
  const engine = {
    getMatchedVacanciesAsync: async () => [...items],
    restore: () => ({ clusters: 0, sources: 0 }),
  } as never;
  const app = await createApp(successProvider, undefined, undefined, {
    multiSourceVacancyEngine: engine,
    candidateCompanyWantsRepo: wants,
  });
  const store = stores.at(-1)!;
  const authorization = candidateAuthorization(app);
  const candidate = store.authenticate(authorization.slice('Bearer '.length))!;
  store.saveResumeDraft(
    candidate.id,
    { ...EMPTY_RESUME_DRAFT, targetRole: 'Руководитель платформы' },
    [],
  );
  const send = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/candidate/companies/want',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: payload as Record<string, unknown>,
    });
  const post = (companyKeys: unknown) => send({ companyKeys });
  return { post, send, wants, candidate };
}

describe('POST /candidate/companies/want (B422)', () => {
  it('добавляет компании подборки одной операцией и считает уже добавленные', async () => {
    const { post, wants, candidate } = await setup(['Вектор Банк', 'Гринкод', 'Облако+']);
    const [a, b, c] = ['Вектор Банк', 'Гринкод', 'Облако+'].map(candidateCompanyKey);
    wants.setWanted(candidate.id, a!, 'Вектор Банк');
    const response = await post([a, b, c, b]);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ added: 2, alreadyWanted: 1 });
    expect(
      wants
        .list(candidate.id)
        .map((want) => want.companyKey)
        .sort(),
    ).toEqual([a, b, c].sort());
  });

  it('чужой или несуществующий ключ — 400, ничего не записано', async () => {
    const { post, wants, candidate } = await setup(['Вектор Банк']);
    const response = await post([candidateCompanyKey('Вектор Банк'), 'company-unknown']);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('company_not_in_selection');
    expect(wants.list(candidate.id)).toEqual([]);
  });

  it('больше 500 ключей или пустой список — 400', async () => {
    const { post } = await setup(['Вектор Банк']);
    expect((await post([])).statusCode).toBe(400);
    expect((await post(Array.from({ length: 501 }, (_, i) => `k-${i}`))).statusCode).toBe(400);
  });
});

describe('POST /candidate/companies/want scope=selection (B422)', () => {
  it('добавляет все компании текущей подборки, ключи считает сервер', async () => {
    const { send, wants, candidate } = await setup(['Вектор Банк', 'Гринкод']);
    const response = await send({ scope: 'selection' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ added: 2, alreadyWanted: 0 });
    expect(wants.list(candidate.id)).toHaveLength(2);
    expect((await send({ scope: 'selection' })).json().data).toEqual({
      added: 0,
      alreadyWanted: 2,
    });
  });

  it('подборка больше лимита — 400, ничего не записано', async () => {
    const { send, wants, candidate } = await setup(
      Array.from({ length: 501 }, (_, i) => `Компания ${i}`),
    );
    expect((await send({ scope: 'selection' })).statusCode).toBe(400);
    expect(wants.list(candidate.id)).toEqual([]);
  });
});

describe('setManyWanted', () => {
  it('пишет всё в одной транзакции: сбой посередине не оставляет половины', () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCandidateCompanyWantsRepository(db, config.dataEncryptionKey);
    opened.push({ db, repo });
    expect(() =>
      repo.setManyWanted('cand', [
        { companyKey: 'k1', companyName: 'A' },
        { companyKey: 'k2', companyName: null as unknown as string },
      ]),
    ).toThrow();
    expect(repo.list('cand')).toEqual([]);
    expect(repo.setManyWanted('cand', [{ companyKey: 'k1', companyName: 'A' }])).toEqual({
      added: 1,
      alreadyWanted: 0,
    });
  });
});
