import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
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
import { candidateCompanyKey } from '../domain/candidateCompanies';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
});

function matchedVacancy(id: string, company: string): MatchedVacancyItem {
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

async function setup(items: readonly MatchedVacancyItem[]) {
  const wantsDb = new DatabaseSync(':memory:');
  const contactsDb = new DatabaseSync(':memory:');
  const wants = new SqliteCandidateCompanyWantsRepository(wantsDb, config.dataEncryptionKey);
  const contacts = new SqliteRecruiterContactsRepository(contactsDb);
  opened.push(() => {
    wants.close();
    contacts.close();
    wantsDb.close();
  });
  const engine = {
    getMatchedVacanciesAsync: async () => [...items],
    restore: () => ({ clusters: 0, sources: 0 }),
  } as never;
  const app = await createApp(successProvider, undefined, undefined, {
    multiSourceVacancyEngine: engine,
    candidateCompanyWantsRepo: wants,
    recruiterContactsRepo: contacts,
  });
  const candidateStore = stores.at(-1)!;
  const candidate = candidateStore.authenticate(
    candidateAuthorization(app).slice('Bearer '.length),
  )!;
  candidateStore.saveResumeDraft(
    candidate.id,
    { ...EMPTY_RESUME_DRAFT, targetRole: 'Руководитель платформы' },
    [],
  );
  return { app, authorization: candidateAuthorization(app), candidate, wants };
}

type App = Awaited<ReturnType<typeof setup>>['app'];
const origin = 'http://localhost:3000';
const profile = (slug: string) => `https://www.linkedin.com/in/${slug}/`;

const readPlan = async (app: App, authorization: string) =>
  (
    await app.inject({
      url: '/api/v1/candidate/connection-contacts/linkedin-search-plan',
      headers: { authorization },
    })
  ).json().data.companies as Array<{ companyKey: string; companyName: string }>;

const sendSearch = (
  app: App,
  authorization: string,
  companyName: string,
  people: readonly Record<string, unknown>[],
) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/candidate/connection-contacts/linkedin-search',
    headers: { authorization, origin },
    payload: { companyName, people },
  });

const importContacts = (app: App, authorization: string, contacts: readonly unknown[]) =>
  app.inject({
    method: 'PUT',
    url: '/api/v1/candidate/connection-contacts/linkedin-import',
    headers: { authorization, origin },
    payload: { contacts },
  });

const listContacts = async (app: App, authorization: string) =>
  (
    await app.inject({
      url: '/api/v1/candidate/connection-contacts?limit=100',
      headers: { authorization },
    })
  ).json().data.items as Array<{ fullName: string; companyName: string; roleTitle: string }>;

describe('LinkedIn company search (B561)', () => {
  it('plans wanted companies first, then vacancy companies, each once', async () => {
    const { app, authorization, candidate, wants } = await setup([
      matchedVacancy('v1', 'Вектор Банк'),
      matchedVacancy('v2', 'Арка'),
      matchedVacancy('v3', 'Арка'),
    ]);
    wants.setWanted(candidate.id, candidateCompanyKey('Север Тех'), 'Север Тех');
    wants.setWanted(candidate.id, candidateCompanyKey('Арка'), 'Арка');

    const plan = await readPlan(app, authorization);

    const names = plan.map((company) => company.companyName);
    expect(names).toHaveLength(3);
    expect(new Set(names.slice(0, 2))).toEqual(new Set(['Север Тех', 'Арка']));
    expect(names[2]).toBe('Вектор Банк');
  });

  it('leaves a searched company out of the plan for 14 days', async () => {
    const { app, authorization } = await setup([
      matchedVacancy('v1', 'Вектор Банк'),
      matchedVacancy('v2', 'Арка'),
    ]);
    expect((await sendSearch(app, authorization, 'Вектор Банк', [])).statusCode).toBe(200);

    const plan = await readPlan(app, authorization);

    expect(plan.map((company) => company.companyName)).toEqual(['Арка']);
  });

  it('gives found people their current company and adds those not yet listed', async () => {
    const { app, authorization } = await setup([matchedVacancy('v1', 'Вектор Банк')]);
    await importContacts(app, authorization, [
      { fullName: 'Анна Тестова', roleTitle: 'Product | Fintech', linkedinUrl: profile('anna-t') },
    ]);

    const response = await sendSearch(app, authorization, 'Вектор', [
      {
        fullName: 'Анна Тестова',
        linkedinUrl: profile('anna-t'),
        roleTitle: 'Head of Product',
        companyName: 'Вектор Банк',
      },
      {
        fullName: 'Борис Пробный',
        linkedinUrl: profile('boris-p'),
        roleTitle: 'Engineer',
        companyName: 'Вектор Банк',
      },
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ updated: 1, added: 1 });
    const listed = await listContacts(app, authorization);
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fullName: 'Анна Тестова',
          companyName: 'Вектор Банк',
          roleTitle: 'Head of Product',
        }),
        expect.objectContaining({ fullName: 'Борис Пробный', companyName: 'Вектор Банк' }),
      ]),
    );
    const companies = (
      await app.inject({ url: '/api/v1/candidate/companies', headers: { authorization } })
    ).json().data.items;
    expect(companies[0]).toMatchObject({ name: 'Вектор Банк', contactsCount: 2 });
  });

  it('keeps a company the search found when a later headline import names none', async () => {
    const { app, authorization } = await setup([matchedVacancy('v1', 'Вектор Банк')]);
    await importContacts(app, authorization, [
      { fullName: 'Анна Тестова', roleTitle: 'Product', linkedinUrl: profile('anna-t') },
    ]);
    await sendSearch(app, authorization, 'Вектор Банк', [
      {
        fullName: 'Анна Тестова',
        linkedinUrl: profile('anna-t'),
        roleTitle: 'Head of Product',
        companyName: 'Вектор Банк',
      },
    ]);

    await importContacts(app, authorization, [
      { fullName: 'Анна Тестова', roleTitle: 'Product | AI', linkedinUrl: profile('anna-t') },
      { fullName: 'Вера Новая', roleTitle: 'CTO at Арка', linkedinUrl: profile('vera-n') },
    ]);

    const listed = await listContacts(app, authorization);
    expect(listed.find((item) => item.fullName === 'Анна Тестова')).toMatchObject({
      companyName: 'Вектор Банк',
      roleTitle: 'Head of Product',
    });
  });

  it('prefers the searched company over a headline that names another one', async () => {
    const { app, authorization } = await setup([matchedVacancy('v1', 'Вектор Банк')]);
    await sendSearch(app, authorization, 'Вектор Банк', [
      {
        fullName: 'Анна Тестова',
        linkedinUrl: profile('anna-t'),
        roleTitle: 'Head of Product',
        companyName: 'Вектор Банк',
      },
    ]);

    await importContacts(app, authorization, [
      {
        fullName: 'Анна Тестова',
        companyName: 'Старое Место',
        roleTitle: 'Head of Product',
        linkedinUrl: profile('anna-t'),
      },
    ]);

    const listed = await listContacts(app, authorization);
    expect(listed.find((item) => item.fullName === 'Анна Тестова')).toMatchObject({
      companyName: 'Вектор Банк',
    });
  });

  it('refuses a search report that names a profile outside LinkedIn', async () => {
    const { app, authorization } = await setup([]);
    const foreignProfile = await sendSearch(app, authorization, 'Арка', [
      {
        fullName: 'Кто-то',
        linkedinUrl: 'https://evil.example/in/x/',
        roleTitle: '',
        companyName: 'Арка',
      },
    ]);
    expect(foreignProfile.statusCode).toBe(422);
  });
});
