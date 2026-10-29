import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { config as baseConfig, successProvider } from './appTestHarness';
import { AuthService } from './auth/authService';
import { SqliteCapabilityConsentStore } from './auth/capabilityConsentStore';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { SqliteNetworkIndexRepository } from './data/sqliteNetworkIndexRepository';
import { SqliteRecruiterContactsRepository } from './data/sqliteRecruiterContactsRepository';
import { candidateCompanyKey } from './domain/candidateCompanies';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import type { MatchedVacancyItem } from './vacancies/multiSourceVacancyEngine';

const origin = 'http://localhost:3000';
const NORTHWIND = 'Northwind Labs';
const profile = (slug: string) => `https://www.linkedin.com/in/${slug}/`;

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

describe('shared LinkedIn network index (B561 slice 2)', () => {
  const openApps: FastifyInstance[] = [];
  const openStores: Array<{ close(): void }> = [];
  const openDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(openApps.splice(0).map((app) => app.close()));
    for (const store of openStores.splice(0).reverse()) {
      try {
        store.close();
      } catch {
        // already closed by the app
      }
    }
    for (const dir of openDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function createEnv() {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-network-'));
    const databasePath = join(directory, 'test.db');
    const candidateStore = new SqliteCandidateStore({
      databasePath,
      encryptionKey: baseConfig.dataEncryptionKey,
    });
    const authService = new AuthService({ databasePath, candidateStore });
    const capabilityConsentStore = new SqliteCapabilityConsentStore({ databasePath });
    const recruiterContactsRepo = new SqliteRecruiterContactsRepository({ databasePath });
    const networkIndexRepo = new SqliteNetworkIndexRepository({ databasePath });
    const engine = {
      getMatchedVacanciesAsync: async () => [matchedVacancy('cluster-nw', NORTHWIND)],
      restore: () => ({ clusters: 0, sources: 0 }),
    } as never;
    const app = await buildApp({
      config: { ...baseConfig, databasePath },
      coachProvider: successProvider,
      candidateStore,
      authService,
      capabilityConsentStore,
      recruiterContactsRepo,
      networkIndexRepo,
      multiSourceVacancyEngine: engine,
      serveStatic: false,
    });
    openApps.push(app);
    openStores.push(candidateStore, authService, recruiterContactsRepo, networkIndexRepo);
    openDirs.push(directory);
    return { app, authService, candidateStore, networkIndexRepo };
  }

  async function register(env: Awaited<ReturnType<typeof createEnv>>, login: string) {
    const registered = await env.authService.register(
      login,
      'valid-password-123',
      env.candidateStore,
    );
    env.candidateStore.saveResumeDraft(
      registered.principal.candidate!.id,
      { ...EMPTY_RESUME_DRAFT, targetRole: 'Руководитель платформы' },
      [],
    );
    return {
      authorization: `Bearer ${registered.sessionToken}`,
      candidateId: registered.principal.candidate!.id,
    };
  }

  const grant = (app: FastifyInstance, authorization: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/me/consents/linkedin_contacts',
      headers: { authorization, origin },
      payload: { versionId: 'linkedin_contacts-v1.0' },
    });

  const revoke = (app: FastifyInstance, authorization: string) =>
    app.inject({
      method: 'DELETE',
      url: '/api/v1/me/consents/linkedin_contacts',
      headers: { authorization, origin },
    });

  const importContacts = (
    app: FastifyInstance,
    authorization: string,
    contacts: readonly Record<string, unknown>[],
  ) =>
    app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/connection-contacts/linkedin-import',
      headers: { authorization, origin },
      payload: { contacts },
    });

  const sendSearch = (
    app: FastifyInstance,
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

  async function secondCircle(app: FastifyInstance, authorization: string) {
    const response = await app.inject({
      url: '/api/v1/candidate/vacancies/cluster-nw/connection-circles',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(200);
    return {
      body: response.body,
      circle: response.json().data.circles.find((item: { circle: number }) => item.circle === 2),
    };
  }

  const jane = { fullName: 'Jane Roe', companyName: NORTHWIND, linkedinUrl: profile('jane-roe') };
  const john = { fullName: 'John Doe', companyName: NORTHWIND, linkedinUrl: profile('john-doe') };

  it('keeps contacts out of the shared index without the consent', async () => {
    const env = await createEnv();
    const member = await register(env, 'member.noconsent');
    const candidate = await register(env, 'candidate.noconsent');

    expect((await importContacts(env.app, member.authorization, [jane])).statusCode).toBe(200);

    expect(env.networkIndexRepo.personCount()).toBe(0);
    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 0 });
  });

  it('shows another candidate only the count of paths through a consenting member', async () => {
    const env = await createEnv();
    const member = await register(env, 'member.consent');
    const candidate = await register(env, 'candidate.target');
    expect((await grant(env.app, member.authorization)).statusCode).toBe(200);

    await importContacts(env.app, member.authorization, [jane]);
    await sendSearch(env.app, member.authorization, NORTHWIND, [
      { ...john, roleTitle: 'Engineering Manager' },
    ]);

    const { circle, body } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 2 });
    expect(body).not.toContain('Jane Roe');
    expect(body).not.toContain('John Doe');
    expect(body).not.toContain('jane-roe');
    expect(body).not.toContain('member.consent');
    expect(body).not.toContain(member.candidateId);
  });

  it('does not count the candidate own contacts as platform paths', async () => {
    const env = await createEnv();
    const member = await register(env, 'member.self');
    expect((await grant(env.app, member.authorization)).statusCode).toBe(200);
    await importContacts(env.app, member.authorization, [jane]);

    const { circle } = await secondCircle(env.app, member.authorization);

    expect(circle.platformPaths).toEqual({ paths: 0 });
  });

  it('adds the contacts imported before the consent once it is given', async () => {
    const env = await createEnv();
    const member = await register(env, 'member.later');
    const candidate = await register(env, 'candidate.later');
    await importContacts(env.app, member.authorization, [jane, john]);

    expect((await grant(env.app, member.authorization)).statusCode).toBe(200);

    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 2 });
  });

  it('removes the member edges when the consent is revoked', async () => {
    const env = await createEnv();
    const member = await register(env, 'member.revoke');
    const candidate = await register(env, 'candidate.revoke');
    await grant(env.app, member.authorization);
    await importContacts(env.app, member.authorization, [jane, john]);

    expect((await revoke(env.app, member.authorization)).statusCode).toBe(200);

    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 0 });
    expect(env.networkIndexRepo.personCount()).toBe(0);
    expect(
      env.networkIndexRepo.countPlatformPaths(candidateCompanyKey(NORTHWIND), '', () => true),
    ).toEqual({ paths: 0, members: 0 });
  });

  it('follows the company of the latest import and skips manual contacts', async () => {
    const env = await createEnv();
    const member = await register(env, 'member.reimport');
    const candidate = await register(env, 'candidate.reimport');
    await grant(env.app, member.authorization);
    await importContacts(env.app, member.authorization, [jane, john]);
    await env.app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/connection-contacts/manual-mary',
      headers: { authorization: member.authorization, origin },
      payload: {
        fullName: 'Mary Major',
        companyName: NORTHWIND,
        linkedinUrl: profile('mary-major'),
        relationship: 'Бывшая коллега',
      },
    });

    await importContacts(env.app, member.authorization, [{ ...jane, companyName: 'Contoso' }]);

    const { circle } = await secondCircle(env.app, candidate.authorization);
    expect(circle.platformPaths).toEqual({ paths: 1 });
  });

  it('removes the member edges when the member deletes the account', async () => {
    const env = await createEnv();
    const member = await register(env, 'member.leaves');
    await grant(env.app, member.authorization);
    await importContacts(env.app, member.authorization, [jane, john]);

    const deleted = await env.app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/me',
      headers: { authorization: member.authorization, origin },
    });

    expect(deleted.statusCode).toBe(204);
    expect(env.networkIndexRepo.personCount()).toBe(0);
  });
});
