import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { SqliteCandidateCompanyWantsRepository } from '../data/sqliteCandidateCompanyWantsRepository';
import { SqliteRecruiterContactsRepository } from '../data/sqliteRecruiterContactsRepository';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import {
  candidateAuthorization,
  config,
  createApp,
  stores,
  successProvider,
} from '../appTestHarness';
import { finishMatchedVacancies } from './matchedVacancyRoutes';

vi.mock('./matchedVacancyRoutes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./matchedVacancyRoutes')>();
  return { ...actual, finishMatchedVacancies: vi.fn(actual.finishMatchedVacancies) };
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
      sources: [],
      status: 'active',
      vacanciesCount: 1,
    },
    explanation: { clusterId: id, roleMatch: 'target', matchingPoints: [], missingPoints: [] },
  } as unknown as MatchedVacancyItem;
}

describe('candidate companies reuse the selection (PRB-041)', () => {
  it('builds the selection once for a list and its company searches, again after a role change', async () => {
    const items = [vacancy('cluster-v1', 'Вектор Банк'), vacancy('cluster-ar', 'Арка Холдинг')];
    const app = await createApp(successProvider, undefined, undefined, {
      multiSourceVacancyEngine: {
        getMatchedVacanciesAsync: async () => [...items],
        restore: () => ({ clusters: 0, sources: 0 }),
      } as never,
      candidateCompanyWantsRepo: new SqliteCandidateCompanyWantsRepository(
        new DatabaseSync(':memory:'),
        config.dataEncryptionKey,
      ),
      recruiterContactsRepo: new SqliteRecruiterContactsRepository(new DatabaseSync(':memory:')),
    });
    const authorization = candidateAuthorization(app);
    const candidateStore = stores.at(-1)!;
    const candidate = candidateStore.authenticate(authorization.slice('Bearer '.length))!;
    const draft = (targetRole: string) =>
      candidateStore.saveResumeDraft(candidate.id, { ...EMPTY_RESUME_DRAFT, targetRole }, []);
    const read = async (query = '') =>
      (
        await app.inject({
          url: `/api/v1/candidate/companies?limit=20${query}`,
          headers: { authorization },
        })
      ).json().data;
    draft('Руководитель платформы');
    const finish = vi.mocked(finishMatchedVacancies);
    finish.mockClear();

    expect((await read()).total).toBe(2);
    const searched = await read('&filter=all&search=Арка');
    expect(searched.items.map((item: { name: string }) => item.name)).toEqual(['Арка Холдинг']);
    expect(finish).toHaveBeenCalledTimes(1);

    draft('Руководитель разработки');
    await read();
    expect(finish).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
