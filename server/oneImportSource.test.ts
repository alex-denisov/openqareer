import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import type { ResumeStructurer } from './providers/resumeStructurer';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 5),
  databasePath: ':memory:',
  model: 'gpt-5.6-sol',
  staticRoot: '/tmp/not-used',
  release: 'test-release',
  logLevel: 'fatal',
  secureCookies: false,
  allowedOrigins: ['http://localhost:3000'],
  seedAccounts: [],
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
    throw new Error('importing a resume must not start a coach turn');
  },
};

/** A real LinkedIn export, reduced to what the extractor hands over. */
const LINKEDIN_MARKDOWN = `<!-- Page 1 -->

# Contact

+7 900 000 0000 (Home) qa.candidate@example.test

# Marina Orlova

VP of Technology & Operations

## Summary

I build and scale technology organizations.

<!-- Page 2 -->

## Experience

OptiLab AI Independent AI Consultant November 2025 - Present (10 months)

- Founded an independent AI advisory practice.

## Education

Universitatea Tehnică a Moldovei Bachelor of Engineering-BE · (2005 - 2010)
`;

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

async function createApp(resumeStructurer?: ResumeStructurer) {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = store.createCandidate({
    dataClass: 'synthetic',
    locale: 'ru-RU',
  });
  const app = await buildApp({
    config,
    coachProvider: unusedProvider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
    resumeStructurer,
  });
  apps.push(app);
  stores.push(store);
  return {
    app,
    store,
    candidateId: candidate.id,
    authorization: `Bearer ${candidate.accessToken}`,
  };
}

function nativeHhImportBody(text = LINKEDIN_MARKDOWN) {
  return {
    text,
    source: 'hh' as const,
    sourceReceipt: {
      platform: 'hh' as const,
      accessMode: 'native_session_snapshot' as const,
      sourceUrl: 'https://hh.ru/resume/synthetic-resume-731',
      capturedAt: '2026-08-23T12:00:00.000Z',
    },
  };
}

function nativeLinkedInImportBody(text = LINKEDIN_MARKDOWN) {
  return {
    text,
    source: 'linkedin' as const,
    sourceReceipt: {
      platform: 'linkedin' as const,
      accessMode: 'native_session_snapshot' as const,
      sourceUrl: 'https://www.linkedin.com/in/synthetic-candidate-731/',
      capturedAt: '2026-08-24T12:00:00.000Z',
    },
  };
}

/** A second, different document so the two platforms' facts never coincide. */
const HH_MARKDOWN = `# Ivan Petrov

Head of Platform Engineering

## Опыт работы

Northwind Logistics Head of Platform Engineering January 2021 - Present

- Built the internal developer platform for 40 teams.

## Образование

Moscow Institute of Physics and Technology Master of Science (2008 - 2014)
`;

describe('one import source per profile (owner decision 23.10.2026)', () => {
  async function postImport(
    app: Awaited<ReturnType<typeof createApp>>['app'],
    authorization: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload,
    });
  }

  async function connectionsOf(
    app: Awaited<ReturnType<typeof createApp>>['app'],
    authorization: string,
  ) {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/connections',
      headers: { authorization },
    });
    return response.json().data as Array<{ platform: string; status: string; factCount?: number }>;
  }

  it('only connects a second platform and leaves the profile built from the first one', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    expect((await postImport(app, authorization, nativeLinkedInImportBody())).statusCode).toBe(200);
    const before = store.getSnapshot(candidateId);

    const second = await postImport(app, authorization, nativeHhImportBody(HH_MARKDOWN));

    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({
      connectOnly: true,
      factCount: 0,
      connection: { platform: 'hh', status: 'connected', factCount: 0 },
    });
    const after = store.getSnapshot(candidateId);
    expect(after.resume?.draft).toEqual(before.resume?.draft);
    expect(after.memory.map((memory) => memory.id).sort()).toEqual(
      before.memory.map((memory) => memory.id).sort(),
    );
    const linkedin = (await connectionsOf(app, authorization)).find((c) => c.platform === 'linkedin');
    expect(linkedin?.factCount).toBeGreaterThan(0);
  });

  it('connects without importing when the candidate asks for connect only', async () => {
    const { app, store, candidateId, authorization } = await createApp();

    const connected = await postImport(app, authorization, {
      ...nativeHhImportBody(HH_MARKDOWN),
      importMode: 'connect_only',
    });

    expect(connected.statusCode).toBe(200);
    expect(connected.json().data).toMatchObject({ connectOnly: true, factCount: 0 });
    expect(store.getSnapshot(candidateId).memory).toHaveLength(0);
  });

  it('replaces the profile with the second platform when the candidate asks for it', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    await postImport(app, authorization, nativeLinkedInImportBody());
    const linkedinFacts = store.getSnapshot(candidateId).memory.map((memory) => memory.id);

    const replaced = await postImport(app, authorization, {
      ...nativeHhImportBody(HH_MARKDOWN),
      importMode: 'replace_profile',
    });

    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().data.factCount).toBeGreaterThan(0);
    const after = store.getSnapshot(candidateId);
    expect(after.memory.some((memory) => linkedinFacts.includes(memory.id))).toBe(false);
    expect(JSON.stringify(after.resume?.draft)).toContain('Head of Platform Engineering');
    const connections = await connectionsOf(app, authorization);
    expect(connections.find((c) => c.platform === 'linkedin')).toMatchObject({
      status: 'connected',
      factCount: 0,
    });
    expect(connections.find((c) => c.platform === 'hh')?.factCount).toBeGreaterThan(0);
  });

  it('still refreshes the profile from the platform it was built from', async () => {
    const { app, authorization } = await createApp();
    await postImport(app, authorization, nativeLinkedInImportBody());

    const updatedProfile = LINKEDIN_MARKDOWN.replace(
      'Founded an independent AI advisory practice.',
      'Founded an independent AI advisory practice serving three banks.',
    );
    const refreshed = await postImport(app, authorization, {
      ...nativeLinkedInImportBody(updatedProfile),
      sourceReceipt: {
        ...nativeLinkedInImportBody().sourceReceipt,
        capturedAt: '2026-09-01T12:00:00.000Z',
      },
    });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().data.connectOnly).toBeUndefined();
    expect(refreshed.json().data.factCount).toBeGreaterThan(0);
  });
});
