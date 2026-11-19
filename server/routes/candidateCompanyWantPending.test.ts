import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { apps, config, noSessions, stores, successProvider } from '../appTestHarness';
import { VacancyMatchUnavailable } from '../vacancies/vacancyMatchReader';

// B645 (прод 19.11): холодное чтение подборки упиралось в потолок читателя 12 с, и
// «Хочу в компанию» дважды отвечал 503, хотя список компаний от подборки не зависит.
vi.mock('../vacancies/matchedPoolContext', async (original) => ({
  ...(await original<typeof import('../vacancies/matchedPoolContext')>()),
  readMatchProfile: () => ({ confirmedSkills: ['Управление'] }),
  readMatchedSnapshot: async () => {
    throw new VacancyMatchUnavailable('vacancy_match_timeout', 12_000, 1);
  },
}));

const ORIGIN = { origin: 'http://localhost:3000' };

async function createApp() {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: successProvider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(candidateStore);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

describe('«Хочу в компанию», пока подборка не прочиталась', () => {
  it('отдаёт компании сразу, без счётчиков вакансий, и просит перезапросить', async () => {
    const { app, authorization } = await createApp();
    const add = {
      operationId: 'b645-wants',
      action: 'add',
      confirmCount: 1,
      companies: [{ companyName: 'Альфа' }],
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/applications/company-wants/bulk',
      headers: { authorization, ...ORIGIN },
      payload: add,
    });
    expect(created.statusCode).toBe(200);

    const page = await app.inject({
      url: '/api/v1/candidate/companies/wants?stage=all&offset=0&limit=20',
      headers: { authorization },
    });
    expect(page.statusCode).toBe(200);
    expect(page.headers['retry-after']).toBe('5');
    expect(page.json().data).toMatchObject({ total: 1, vacanciesPending: true });
    expect(page.json().data.items.map((item: { name: string }) => item.name)).toEqual(['Альфа']);
  });
});
