import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect } from 'vitest';
import { CAPABILITY_CONSENT_CURRENT_VERSION } from '../src/features/legal/capabilityConsents';
import { buildApp } from './app';
import { config as baseConfig, successProvider } from './appTestHarness';
import { AuthService } from './auth/authService';
import { SqliteCapabilityConsentStore } from './auth/capabilityConsentStore';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { SqliteNetworkIndexRepository } from './data/sqliteNetworkIndexRepository';
import { SqliteRecruiterContactsRepository } from './data/sqliteRecruiterContactsRepository';
import { EMPTY_RESUME_DRAFT, type ResumeCandidateInput } from './domain/resumeDraft';
import type { MatchedVacancyItem } from './vacancies/multiSourceVacancyEngine';

/** B561: two or more real accounts on one database, for the cross-account network tests. */
export const origin = 'http://localhost:3000';
export const NORTHWIND = 'Northwind Labs';
export const profile = (slug: string) => `https://www.linkedin.com/in/${slug}/`;
export const jane = {
  fullName: 'Jane Roe',
  companyName: NORTHWIND,
  linkedinUrl: profile('jane-roe'),
};
export const john = {
  fullName: 'John Doe',
  companyName: NORTHWIND,
  linkedinUrl: profile('john-doe'),
};

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

export async function createNetworkEnv() {
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

export type NetworkEnv = Awaited<ReturnType<typeof createNetworkEnv>>;

export async function registerMember(
  env: NetworkEnv,
  login: string,
  candidate: ResumeCandidateInput = {},
) {
  const registered = await env.authService.register(
    login,
    'valid-password-123',
    env.candidateStore,
  );
  env.candidateStore.saveResumeDraft(
    registered.principal.candidate!.id,
    { ...EMPTY_RESUME_DRAFT, candidate, targetRole: 'Руководитель платформы' },
    [],
  );
  return {
    authorization: `Bearer ${registered.sessionToken}`,
    candidateId: registered.principal.candidate!.id,
  };
}

export const grantContactsConsent = (app: FastifyInstance, authorization: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/me/consents/linkedin_contacts',
    headers: { authorization, origin },
    payload: { versionId: CAPABILITY_CONSENT_CURRENT_VERSION.linkedin_contacts },
  });

export const revokeContactsConsent = (app: FastifyInstance, authorization: string) =>
  app.inject({
    method: 'DELETE',
    url: '/api/v1/me/consents/linkedin_contacts',
    headers: { authorization, origin },
  });

export const importContacts = (
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

export const sendSearch = (
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

export async function secondCircle(app: FastifyInstance, authorization: string) {
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
