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

type CandidateCompanyTestSetup = Awaited<ReturnType<typeof setup>>;
type ManualConnectionInput = {
  fullName: string;
  companyName: string;
  roleTitle: string;
  relationship: string;
  strength: 'strong' | 'weak' | 'unknown';
  workplaces: Array<{ companyName: string; startDate: string; endDate: string }>;
  knowsRecruiterIds: string[];
};

function manualConnectionInput(
  overrides: Partial<ManualConnectionInput> = {},
): ManualConnectionInput {
  return {
    fullName: 'Анна Седова',
    companyName: 'Финтех Лаб',
    roleTitle: 'Продакт-менеджер',
    relationship: 'Работали вместе до 2021 года',
    strength: 'strong',
    workplaces: [{ companyName: 'Финтех Лаб', startDate: '2018', endDate: '2021' }],
    knowsRecruiterIds: [],
    ...overrides,
  };
}

async function saveManualConnection(
  app: CandidateCompanyTestSetup['app'],
  authorization: string,
  contactId: string,
  payload: ManualConnectionInput,
) {
  return app.inject({
    method: 'PUT',
    url: `/api/v1/candidate/connection-contacts/${contactId}`,
    headers: { authorization, origin: 'http://localhost:3000' },
    payload,
  });
}

async function importConnectionContacts(
  app: CandidateCompanyTestSetup['app'],
  authorization: string,
  contacts: readonly Record<string, unknown>[],
) {
  return app.inject({
    method: 'PUT',
    url: '/api/v1/candidate/connection-contacts/linkedin-import',
    headers: { authorization, origin: 'http://localhost:3000' },
    payload: { contacts },
  });
}

async function listConnectionContacts(
  app: CandidateCompanyTestSetup['app'],
  authorization: string,
) {
  return app.inject({ url: '/api/v1/candidate/connection-contacts', headers: { authorization } });
}

function seedTargetRecruiter(
  contacts: SqliteRecruiterContactsRepository,
  candidateId: string,
): void {
  contacts.saveContacts(candidateId, 'cluster-v1', [
    {
      id: 'target-recruiter',
      vacancyId: 'cluster-v1',
      companyName: 'Вектор Банк',
      fullName: 'Сергей Б.',
      roleTitle: 'Руководитель платежей',
      email: null,
      emailStatus: 'unverified',
      phone: null,
      telegram: null,
      whatsapp: null,
      linkedinUrl: 'https://www.linkedin.com/in/sergey-b',
      githubUrl: null,
      twitterUrl: null,
      sourceType: 'linkedin_pool',
      confidence: 0.5,
      sourceReceipt: {
        receiptId: 'receipt-target',
        source: 'linkedin_pool',
        method: 'pool_session',
        observedAt: '2026-10-08T12:00:00.000Z',
        confidence: 0.5,
      },
      createdAt: '2026-10-08T12:00:00.000Z',
      updatedAt: '2026-10-08T12:00:00.000Z',
    },
  ]);
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

  it('wants a company by name when it is not in the candidate list yet (B422)', async () => {
    const { app, authorization, candidate, wants } = await setup([]);
    const headers = { authorization, origin: 'http://localhost:3000' };
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/company-wants',
      headers,
      payload: { companyName: 'NewStore' },
    });
    expect(response.statusCode).toBe(200);
    const key = candidateCompanyKey('NewStore');
    expect(response.json().data).toMatchObject({ key, name: 'NewStore', want: true });
    expect(wants.get(candidate.id, key)).toMatchObject({ companyName: 'NewStore' });
    const blank = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/company-wants',
      headers,
      payload: { companyName: '  ' },
    });
    expect(blank.statusCode).toBe(400);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/candidate/companies/${key}/want`,
      headers,
    });
    expect(removed.statusCode).toBe(200);
    expect(wants.get(candidate.id, key)).toBeFalsy();
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

describe('recruiter search repeat', () => {
  it('searches again when an earlier finished search found nobody', async () => {
    const items = [matchedVacancy('cluster-v2', 'Вектор Банк')];
    const { app, authorization, candidate, contacts, consent } = await setup(items);
    consent.set(candidate.id, { granted: true, policyVersion: SEARCH_CONSENT_POLICY_VERSION });
    const job = contacts.enqueueJob(candidate.id, 'cluster-v2');
    contacts.claimJobs(1);
    contacts.finishJob(job.id, 'ready');
    const url = `/api/v1/candidate/companies/${candidateCompanyKey('Вектор Банк')}/recruiter-search`;

    const response = await app.inject({
      method: 'POST',
      url,
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(contacts.getJob(candidate.id, 'cluster-v2')?.status).toBe('queued');
  });
});

describe('B448 candidate connection circles', () => {
  it('puts an imported LinkedIn contact at the vacancy company into circle 1 (B448)', async () => {
    const { app, authorization } = await setup([matchedVacancy('cluster-v1', 'Вектор Банк')]);
    // The body the desktop client sends after reading the connections list.
    const imported = await importConnectionContacts(app, authorization, [
      {
        fullName: 'Ирина Котова',
        companyName: 'Вектор Банк',
        roleTitle: 'Head of QA',
        linkedinUrl: 'https://www.linkedin.com/in/irina-kotova-test/',
      },
      {
        fullName: 'Петр Волков',
        companyName: 'Север Тех',
        roleTitle: 'Engineering Manager',
        linkedinUrl: 'https://www.linkedin.com/in/petr-volkov-test/',
      },
    ]);
    expect(imported.statusCode).toBe(200);

    const response = await app.inject({
      url: '/api/v1/candidate/vacancies/cluster-v1/connection-circles',
      headers: { authorization },
    });
    const [first] = response.json().data.circles;
    expect(first.circle).toBe(1);
    expect(first.paths).toHaveLength(1);
    expect(first.paths[0]).toMatchObject({
      circle: 1,
      source: 'linkedin_import',
      nextStep: 'write_known_contact',
      recipient: { fullName: 'Ирина Котова', companyName: 'Вектор Банк' },
    });
  });

  it('accepts a full network import well above 400 contacts (B448)', async () => {
    const { app, authorization } = await setup([matchedVacancy('cluster-v1', 'Вектор Банк')]);
    const contacts = Array.from({ length: 1_500 }, (_, index) => ({
      fullName: `Контакт ${index}`,
      companyName: `Компания ${index % 300}`,
      roleTitle: 'Engineer',
      linkedinUrl: `https://www.linkedin.com/in/contact-${index}-test/`,
    }));
    const imported = await importConnectionContacts(app, authorization, contacts);
    expect(imported.statusCode).toBe(200);
    expect(imported.json().data.importedCount).toBe(1_500);
  });

  it('keeps missing connections unknown and makes an imported empty list distinct', async () => {
    const { app, authorization } = await setup([matchedVacancy('cluster-v1', 'Вектор Банк')]);
    const path = '/api/v1/candidate/vacancies/cluster-v1/connection-circles';
    const unknown = await app.inject({ url: path, headers: { authorization } });
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().data.circles).toMatchObject([
      { circle: 1, state: 'unknown' },
      { circle: 2, state: 'unknown' },
      { circle: 3, state: 'available' },
    ]);
    expect((await importConnectionContacts(app, authorization, [])).statusCode).toBe(200);
    const knownEmpty = await app.inject({ url: path, headers: { authorization } });
    expect(knownEmpty.json().data.circles).toMatchObject([
      { circle: 1, state: 'none' },
      { circle: 2, state: 'none' },
      { circle: 3, state: 'available' },
    ]);
  });

  it('creates, edits, pages and deletes a manual contact', async () => {
    const { app, authorization } = await setup([]);
    const created = await saveManualConnection(
      app,
      authorization,
      'manual-1',
      manualConnectionInput(),
    );
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ id: 'manual-1', source: 'manual' });
    const page = await listConnectionContacts(app, authorization);
    expect(page.json().data).toMatchObject({ total: 1, limit: 50, offset: 0 });
    expect(page.json().data.items[0].fullName).toBe('Анна Седова');
    const edited = await saveManualConnection(
      app,
      authorization,
      'manual-1',
      manualConnectionInput({ relationship: 'Общая профессиональная группа' }),
    );
    expect(edited.json().data.relationship).toBe('Общая профессиональная группа');
    const url = '/api/v1/candidate/connection-contacts/manual-1';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url,
            headers: { authorization, origin: 'http://localhost:3000' },
          })
        ).statusCode,
      ).toBe(204);
    }
    expect((await listConnectionContacts(app, authorization)).json().data.total).toBe(0);
  });

  it('scopes equal manual contact IDs to their candidate', async () => {
    const { app, authorization, candidate, candidateStore, contacts } = await setup([]);
    const first = await saveManualConnection(
      app,
      authorization,
      'manual-shared',
      manualConnectionInput(),
    );
    const credentials = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    const secondCandidate = candidateStore.authenticate(credentials.accessToken)!;
    const second = await saveManualConnection(
      app,
      `Bearer ${credentials.accessToken}`,
      'manual-shared',
      manualConnectionInput({ fullName: 'Игорь Н.' }),
    );
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
    expect(contacts.listContactsByCandidateId(candidate.id)).toHaveLength(1);
    expect(contacts.listContactsByCandidateId(secondCandidate.id)).toHaveLength(1);
  });

  it('deletes candidate-owned connections with the account', async () => {
    const { app, authorization, candidate, contacts } = await setup([]);
    await saveManualConnection(app, authorization, 'manual-delete', manualConnectionInput());
    expect(
      (
        await importConnectionContacts(app, authorization, [
          {
            externalId: 'linkedin-1',
            fullName: 'Игорь Н.',
            companyName: 'Другая компания',
          },
        ])
      ).statusCode,
    ).toBe(200);
    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/me',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(deleted.statusCode).toBe(204);
    expect(contacts.listContactsByCandidateId(candidate.id)).toEqual([]);
  });

  it('keeps manual entries and handles identical imports idempotently', async () => {
    const { app, authorization } = await setup([]);
    await saveManualConnection(app, authorization, 'manual-kept', manualConnectionInput());
    const payload = [
      {
        externalId: 'linkedin-contact-1',
        fullName: 'Игорь Н.',
        companyName: 'Другая компания',
        roleTitle: 'Продакт-менеджер',
        relationship: 'Вы переписывались 14.08',
        strength: 'strong',
        workplaces: [],
        knowsRecruiterIds: [],
      },
    ];
    const imported = await importConnectionContacts(app, authorization, payload);
    const repeated = await importConnectionContacts(app, authorization, payload);
    expect(imported.statusCode).toBe(200);
    expect(repeated.json().data.importedAt).toBe(imported.json().data.importedAt);
    const contacts = await listConnectionContacts(app, authorization);
    expect(contacts.json().data.total).toBe(2);
    expect(contacts.json().data.items.map((item: { id: string }) => item.id)).toContain(
      'manual-kept',
    );
  });

  it('keeps imported contacts read-only and prevents false deletion success', async () => {
    const { app, authorization } = await setup([]);
    await importConnectionContacts(app, authorization, [
      {
        externalId: 'linkedin-readonly',
        fullName: 'Игорь Н.',
        companyName: 'Другая компания',
      },
    ]);
    const contacts = await listConnectionContacts(app, authorization);
    const id = contacts.json().data.items[0].id;
    const headers = { authorization, origin: 'http://localhost:3000' };
    const url = `/api/v1/candidate/connection-contacts/${id}`;
    expect(
      (await app.inject({ method: 'PUT', url, headers, payload: manualConnectionInput() }))
        .statusCode,
    ).toBe(409);
    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(409);
    expect((await listConnectionContacts(app, authorization)).json().data.total).toBe(1);
  });

  it('returns a second-degree path without exposing recruiter source details', async () => {
    const { app, authorization, candidate, contacts } = await setup([
      matchedVacancy('cluster-v1', 'Вектор Банк'),
    ]);
    seedTargetRecruiter(contacts, candidate.id);
    await importConnectionContacts(app, authorization, [
      {
        externalId: 'linkedin-connector',
        fullName: 'Игорь Н.',
        companyName: 'Другая компания',
        roleTitle: 'Продакт-менеджер',
        relationship: 'Вы переписывались 14.08',
        strength: 'strong',
        workplaces: [],
        knowsRecruiterIds: ['target-recruiter'],
      },
    ]);
    const response = await app.inject({
      url: '/api/v1/candidate/vacancies/cluster-v1/connection-circles',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.circles[1].paths[0]).toMatchObject({
      circle: 2,
      strength: 'strong',
      nextStep: 'ask_for_introduction',
      recipient: { id: 'target-recruiter', fullName: 'Сергей Б.' },
      path: [{ fullName: 'Кандидат' }, { fullName: 'Игорь Н.' }, { fullName: 'Сергей Б.' }],
    });
    expect(JSON.stringify(response.json())).not.toMatch(
      /linkedin_pool|pool_session|probability|вероятност|процент/iu,
    );
  });
  it('counts network contacts per company only after a contact import (B439)', async () => {
    const { app, authorization } = await setup([
      matchedVacancy('cluster-v1', 'Вектор Банк'),
      matchedVacancy('cluster-ar', 'Арка Холдинг'),
    ]);
    const before = (
      await app.inject({ url: '/api/v1/candidate/companies', headers: { authorization } })
    ).json().data;
    expect(before.filterCounts.contacts).toBeNull();
    expect(
      (
        await importConnectionContacts(app, authorization, [
          { externalId: 'li-1', fullName: 'Мария Орлова', companyName: 'Вектор Банк' },
          { externalId: 'li-2', fullName: 'Дмитрий Козлов', companyName: 'ВЕКТОР БАНК' },
          { externalId: 'li-3', fullName: 'Игорь Н.', companyName: 'Другая компания' },
        ])
      ).statusCode,
    ).toBe(200);
    const after = (
      await app.inject({ url: '/api/v1/candidate/companies', headers: { authorization } })
    ).json().data;
    const byName = (name: string) =>
      after.items.find((item: { name: string }) => item.name === name);
    expect(byName('Вектор Банк')).toMatchObject({ contactsCount: 2 });
    expect(byName('Вектор Банк').contactsImportedAt).toEqual(expect.any(String));
    expect(byName('Арка Холдинг')).toMatchObject({ contactsCount: 0 });
    expect(after.filterCounts.contacts).toBe(1);
    expect(after.linkedin.contactsImported).toBe(true);
  });
  it('remembers «Не сейчас» for the consultant contact proposal across reloads (B439)', async () => {
    const { app, authorization, candidate, wants } = await setup([
      matchedVacancy('cluster-v1', 'Вектор Банк'),
    ]);
    const key = candidateCompanyKey('Вектор Банк');
    wants.setWanted(candidate.id, key, 'Вектор Банк');
    const dismissed = await app.inject({
      method: 'PUT',
      url: `/api/v1/candidate/companies/${key}/contact-proposal-dismissal`,
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(dismissed.statusCode).toBe(200);
    const list = (
      await app.inject({ url: '/api/v1/candidate/companies', headers: { authorization } })
    ).json().data;
    expect(list.items[0]).toMatchObject({ name: 'Вектор Банк', contactProposalDismissed: true });
    const foreign = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/companies/not-a-key/contact-proposal-dismissal',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(foreign.statusCode).toBe(404);
  });
});
