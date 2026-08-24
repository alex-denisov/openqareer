import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';

/**
 * The product printed "32 подтверждено" for a candidate who had confirmed
 * nothing: the import inserted every extracted statement with a hard-coded
 * `status: 'confirmed'`. Confirming has to be something the candidate does,
 * and doing it for a whole import must not cost one request per fact (B166).
 */

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 9),
  databasePath: ':memory:',
  model: 'gpt-5.6-sol',
  staticRoot: '/tmp/not-used',
  release: 'test-release',
  logLevel: 'fatal',
  secureCookies: false,
  allowedOrigins: ['http://localhost:3000'],
  seedAccounts: [],
  oauthProviders: {},
};

const noSessions: SessionAuth = {
  async register() {
    throw new Error('registration unavailable in this test double');
  },
  async login() {
    return null;
  },
  isUsernameTaken() {
    return false;
  },
  authenticate() {
    return null;
  },
  logout() {},
};

const unusedProvider: CoachProvider = {
  async createTurn() {
    throw new Error('reviewing facts must not start a coach turn');
  },
};

const RESUME = `<!-- Page 1 -->

# Marina Orlova

VP of Technology & Operations

## Summary

I build and scale technology organizations.

## Experience

OptiLab AI Independent AI Consultant November 2025 - Present (10 months)

- Founded an independent AI advisory practice.
- Cut onboarding time by 40% for three enterprise clients.

Fintech Bureau Head of Platform January 2021 - October 2025 (4 years 10 months)

- Grew the platform team from 8 to 34 engineers.
- Reduced payment incident rate by 62%.

## Education

Universitatea Tehnică a Moldovei Bachelor of Engineering-BE · (2005 - 2010)

## Skills

TypeScript, Kubernetes, Product Discovery, Team Leadership
`;

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

async function createApp() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const app = await buildApp({
    config,
    coachProvider: unusedProvider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(store);
  return { app, authorization: `Bearer ${candidate.accessToken}` };
}

type Snapshot = {
  memory: { id: string; status: string; kind: string }[];
  dossier: { confirmedCount: number; proposedCount: number };
};

async function importResume(
  app: Awaited<ReturnType<typeof buildApp>>,
  authorization: string,
): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/candidate/resume/import',
    headers: { authorization },
    payload: { text: RESUME, source: 'linkedin', fileName: 'linkedin.pdf' },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.factCount as number;
}

async function readSnapshot(
  app: Awaited<ReturnType<typeof buildApp>>,
  authorization: string,
): Promise<Snapshot> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/candidate/me',
    headers: { authorization },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data as Snapshot;
}

async function importHhSnapshot(
  app: Awaited<ReturnType<typeof buildApp>>,
  authorization: string,
  text: string,
  capturedAt: string,
): Promise<number> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/candidate/resume/import',
    headers: { authorization },
    payload: {
      text,
      source: 'hh',
      sourceReceipt: {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        sourceUrl: 'https://hh.ru/resume/synthetic-resume-166',
        capturedAt,
      },
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json().data.factCount as number;
}

function factIds(snapshot: Snapshot): string[] {
  return snapshot.memory.filter((item) => item.kind !== 'open-question').map((item) => item.id);
}

describe('candidate fact review', () => {
  it('presents imported facts as awaiting review, not as confirmed by the candidate', async () => {
    const { app, authorization } = await createApp();

    const factCount = await importResume(app, authorization);
    expect(factCount).toBeGreaterThan(0);

    const snapshot = await readSnapshot(app, authorization);
    expect(snapshot.dossier.confirmedCount).toBe(0);
    expect(snapshot.dossier.proposedCount).toBe(factCount);
    expect(
      snapshot.memory
        .filter((item) => item.kind !== 'open-question')
        .every((item) => item.status === 'proposed'),
    ).toBe(true);
  });

  it('confirms a whole import in one request instead of one request per fact', async () => {
    const { app, authorization } = await createApp();
    const factCount = await importResume(app, authorization);
    const ids = factIds(await readSnapshot(app, authorization));

    const reviewed = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/memory/review',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { action: 'confirm', memoryIds: ids },
    });

    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().data).toMatchObject({ reviewed: factCount });

    const after = await readSnapshot(app, authorization);
    expect(after.dossier.confirmedCount).toBe(factCount);
    expect(after.dossier.proposedCount).toBe(0);
  });

  it('drops rejected facts out of the dossier instead of counting them as evidence', async () => {
    const { app, authorization } = await createApp();
    await importResume(app, authorization);
    const ids = factIds(await readSnapshot(app, authorization));

    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/memory/review',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { action: 'delete', memoryIds: ids.slice(0, 2) },
    });
    expect(rejected.statusCode).toBe(200);

    const after = await readSnapshot(app, authorization);
    expect(factIds(after)).toHaveLength(ids.length - 2);
    expect(after.dossier.confirmedCount + after.dossier.proposedCount).toBe(ids.length - 2);
  });

  it('counts a repeated id once instead of inflating what the candidate decided', async () => {
    const { app, authorization } = await createApp();
    await importResume(app, authorization);
    const ids = factIds(await readSnapshot(app, authorization));

    const reviewed = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/memory/review',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: { action: 'confirm', memoryIds: [ids[0]!, ids[0]!, ids[1]!] },
    });

    expect(reviewed.json().data).toMatchObject({ reviewed: 2 });
    expect((await readSnapshot(app, authorization)).dossier.confirmedCount).toBe(2);
  });

  it('refuses to review a fact that belongs to nobody in this dossier', async () => {
    const { app, authorization } = await createApp();
    await importResume(app, authorization);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/memory/review',
      headers: { authorization, origin: 'http://localhost:3000' },
      payload: {
        action: 'confirm',
        memoryIds: ['3f1d1a5e-0000-4000-8000-000000000000'],
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it('replaces an unreviewed platform snapshot instead of duplicating the dossier', async () => {
    const { app, authorization } = await createApp();

    const first = await importHhSnapshot(app, authorization, RESUME, new Date(Date.now() - 3_600_000).toISOString());
    const second = await importHhSnapshot(
      app,
      authorization,
      `${RESUME}\n- Shipped a self-serve billing flow.\n`,
      new Date().toISOString(),
    );

    const after = await readSnapshot(app, authorization);
    expect(second).toBeGreaterThanOrEqual(first);
    expect(factIds(after)).toHaveLength(second);
  });
});
