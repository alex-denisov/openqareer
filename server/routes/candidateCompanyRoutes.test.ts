import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { CandidateCompanyRecruiter } from '../../shared/candidateCompany';
import { SEARCH_CONSENT_POLICY_VERSION } from '../../shared/searchConsent';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { SqliteCandidateCompanyWantsRepository } from '../data/sqliteCandidateCompanyWantsRepository';
import { SqliteRecruiterContactsRepository } from '../data/sqliteRecruiterContactsRepository';
import { SqliteSearchConsentRepository } from '../data/sqliteSearchConsentRepository';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import {
  candidateAuthorization,
  config,
  createApp,
  stores,
  successProvider,
} from '../appTestHarness';
import { candidateCompanyKey } from '../domain/candidateCompanies';

const external: Array<{
  wantsDb: DatabaseSync;
  contactsDb: DatabaseSync;
  consentDb: DatabaseSync;
  wants: SqliteCandidateCompanyWantsRepository;
  contacts: SqliteRecruiterContactsRepository;
  consent: SqliteSearchConsentRepository;
}> = [];

afterEach(() => {
  for (const value of external.splice(0)) {
    value.wants.close();
    value.contacts.close();
    value.consent.close();
    value.wantsDb.close();
  }
});

function matchedVacancy(id: string, company: string): MatchedVacancyItem {
  return {
    cluster: {
      id,
      canonicalTitle: 'Руководитель платформы',
      canonicalCompany: company,
      canonicalLocation: 'Москва, гибрид',
      isRemote: false,
      skills: [],
      descriptionSummary: 'Описание вакансии.',
      primaryUrl: `https://hh.ru/vacancy/${id}`,
      sources: [
        {
          sourceId: 'hh',
          sourceName: 'hh.ru',
          sourceType: 'direct',
          sourceUrl: `https://hh.ru/vacancy/${id}`,
          observedAt: '2026-10-08T10:00:00.000Z',
        },
      ],
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

async function setup(items: readonly MatchedVacancyItem[] = []) {
  const wantsDb = new DatabaseSync(':memory:');
  const contactsDb = new DatabaseSync(':memory:');
  const consentDb = new DatabaseSync(':memory:');
  const wants = new SqliteCandidateCompanyWantsRepository(wantsDb, config.dataEncryptionKey);
  const contacts = new SqliteRecruiterContactsRepository(contactsDb);
  const consent = new SqliteSearchConsentRepository(consentDb);
  external.push({ wantsDb, contactsDb, consentDb, wants, contacts, consent });
  const engine = {
    getMatchedVacanciesAsync: async () => [...items],
    restore: () => ({ clusters: 0, sources: 0 }),
  } as never;
  const app = await createApp(successProvider, undefined, undefined, {
    multiSourceVacancyEngine: engine,
    candidateCompanyWantsRepo: wants,
    recruiterContactsRepo: contacts,
    searchConsentRepo: consent,
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
  return {
    app,
    authorization: candidateAuthorization(app),
    candidateStore,
    candidate,
    wants,
    contacts,
    consent,
  };
}

describe('candidate company routes (B439)', () => {
  it('lists matched companies and retains a wanted company with no vacancies', async () => {
    const { app, authorization, candidate, wants } = await setup([
      matchedVacancy('cluster-v1', 'Вектор Банк'),
      matchedVacancy('cluster-v2', 'Вектор Банк'),
      matchedVacancy('cluster-ar', 'Арка Холдинг'),
    ]);
    wants.setWanted(candidate.id, candidateCompanyKey('Маркет Софт'), 'Маркет Софт');

    const response = await app.inject({
      url: '/api/v1/candidate/companies?limit=20',
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.total).toBe(3);
    expect(
      body.items.find((item: { name: string }) => item.name === 'Вектор Банк')?.vacancyCount,
    ).toBe(2);
    expect(body.items.find((item: { name: string }) => item.name === 'Маркет Софт')).toMatchObject({
      vacancyCount: 0,
      want: true,
    });
    expect(
      body.items.every((item: { contactsCount: number | null }) => item.contactsCount === null),
    ).toBe(true);
    expect(body.linkedin).toMatchObject({ status: 'disconnected', contactsImported: false });
  });

  it('paginates the full company set by twenty and sorts by the selected rule', async () => {
    const items = Array.from({ length: 37 }, (_, index) =>
      matchedVacancy(`cluster-${index}`, `Компания ${String(index).padStart(2, '0')}`),
    );
    const { app, authorization } = await setup(items);

    const first = await app.inject({
      url: '/api/v1/candidate/companies?limit=20&sort=alphabetical',
      headers: { authorization },
    });
    const second = await app.inject({
      url: '/api/v1/candidate/companies?limit=20&offset=20&sort=alphabetical',
      headers: { authorization },
    });

    expect(first.json().data.items).toHaveLength(20);
    expect(second.json().data.items).toHaveLength(17);
    expect(first.json().data.items[0].name).toBe('Компания 00');
    expect(second.json().data.items[0].name).toBe('Компания 20');
  });

  it('persists and removes a wanted company and its next step idempotently', async () => {
    const { app, authorization, candidate, wants } = await setup([
      matchedVacancy('cluster-v1', 'Вектор Банк'),
    ]);
    const key = candidateCompanyKey('Вектор Банк');
    const url = `/api/v1/candidate/companies/${key}/want`;
    const headers = { authorization, origin: 'http://localhost:3000' };

    expect((await app.inject({ method: 'PUT', url, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url, headers })).statusCode).toBe(200);
    const step = await app.inject({
      method: 'PUT',
      url: `/api/v1/candidate/companies/${key}/next-step`,
      headers,
      payload: { text: 'Написать Марии Орловой', dueAt: '2026-10-10' },
    });
    expect(step.statusCode).toBe(200);
    expect(wants.get(candidate.id, key)).toMatchObject({
      nextStep: 'Написать Марии Орловой',
      nextStepDueAt: '2026-10-10',
    });

    const page = await app.inject({
      url: '/api/v1/candidate/companies',
      headers: { authorization },
    });
    expect(page.json().data.items[0]).toMatchObject({
      want: true,
      nextStep: { text: 'Написать Марии Орловой', dueAt: '2026-10-10' },
    });
    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(200);
  });

  it('requires search consent and returns only candidate-safe recruiter provenance', async () => {
    const items = [matchedVacancy('cluster-v1', 'Вектор Банк')];
    const { app, authorization, candidate, contacts, consent } = await setup(items);
    const companyKey = candidateCompanyKey('Вектор Банк');
    const url = `/api/v1/candidate/companies/${companyKey}/recruiter-search`;
    const headers = { authorization, origin: 'http://localhost:3000' };
    const refused = await app.inject({ method: 'POST', url, headers, payload: {} });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('search_consent_required');

    consent.set(candidate.id, { granted: true, policyVersion: SEARCH_CONSENT_POLICY_VERSION });
    const queued = await app.inject({ method: 'POST', url, headers, payload: {} });
    expect(queued.statusCode).toBe(202);
    expect(queued.json().data.searchStatus).toBe('queued');

    const contact = {
      id: 'contact-1',
      vacancyId: 'cluster-v1',
      companyName: 'Вектор Банк',
      fullName: 'Анна Седова',
      roleTitle: 'Recruiter',
      email: null,
      emailStatus: 'unverified' as const,
      phone: null,
      telegram: null,
      whatsapp: null,
      linkedinUrl: 'https://www.linkedin.com/in/anna-sedova',
      githubUrl: null,
      twitterUrl: null,
      sourceType: 'linkedin_pool',
      confidence: 0.5,
      sourceReceipt: {
        receiptId: 'receipt-internal',
        source: 'linkedin_pool',
        method: 'pool_session',
        observedAt: '2026-10-08T12:00:00.000Z',
        confidence: 0.5,
        sourceUrl: 'https://www.linkedin.com/in/anna-sedova',
      },
      createdAt: '2026-10-08T12:00:00.000Z',
      updatedAt: '2026-10-08T12:00:00.000Z',
    };
    contacts.saveContacts(candidate.id, 'cluster-v1', [contact]);

    const page = await app.inject({
      url: '/api/v1/candidate/companies',
      headers: { authorization },
    });
    const body = JSON.stringify(page.json());
    expect(body).not.toContain('linkedin_pool');
    expect(body).not.toContain('pool_session');
    expect(page.json().data.items[0].recruiters[0]).toMatchObject({
      fullName: 'Анна Седова',
      source: 'public-profile',
      sourceDate: '2026-10-08T12:00:00.000Z',
      isHypothesis: true,
    } satisfies Partial<CandidateCompanyRecruiter>);
  });
});
