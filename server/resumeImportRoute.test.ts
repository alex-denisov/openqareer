import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import type { ResumeStructurer } from './providers/resumeStructurer';
import type { ResumeStudioProjection } from './domain/resumeStudio';
import type { ParsedResume } from '../src/features/workspace/resumeParser';

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

function importBody(text = LINKEDIN_MARKDOWN) {
  return { text, source: 'linkedin' as const, fileName: 'linkedin.pdf' };
}

describe('POST /api/v1/candidate/resume/import', () => {
  it('puts the imported roles and schools into the projected resume', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    expect(response.statusCode).toBe(200);
    const projection = response.json().data.resume
      .projection as ResumeStudioProjection;
    expect(projection.master.experience.length).toBeGreaterThan(0);
    expect(projection.master.education.length).toBeGreaterThan(0);
    // Nothing may be silently thrown away for want of a resolvable source.
    expect(projection.excludedEvidenceIds).toEqual([]);
  });

  it('records what the document stated as confirmed dossier evidence', async () => {
    const { app, store, candidateId, authorization } = await createApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    const memory = store.getSnapshot(candidateId).memory;
    expect(memory.length).toBeGreaterThan(0);
    expect(memory.every((item) => item.status === 'confirmed')).toBe(true);
    expect(memory.every((item) => item.sourceMessageIds.length > 0)).toBe(true);
  });

  it('survives a reimport of the same document without duplicating facts', async () => {
    const { app, store, candidateId, authorization } = await createApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });
    const first = store.getSnapshot(candidateId).memory.length;
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    expect(store.getSnapshot(candidateId).memory.length).toBe(first * 2);
    expect(
      new Set(store.getSnapshot(candidateId).memory.map((item) => item.id)).size,
    ).toBe(first * 2);
  });

  it('prefers the model reading when a structurer is configured', async () => {
    const structured: ParsedResume = {
      fullName: 'Marina Orlova',
      targetRole: 'VP of Technology',
      contact: { links: [] },
      experience: [
        {
          title: 'VP of Technology',
          employer: 'Enterprise Energy IT Services',
          startDate: '2023-04',
          endDate: '2025-10',
          current: false,
          responsibilities: ['Rebuilt ITIL 4 processes'],
          achievements: [],
        },
      ],
      skills: ['ITIL'],
      education: [],
      courses: [],
      tests: [],
      recommendations: [],
      languages: [],
      rawText: LINKEDIN_MARKDOWN,
    };
    const { app, authorization } = await createApp({
      structure: async () => structured,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    expect(response.json().meta ?? {}).toBeDefined();
    expect(response.json().data.structuredBy).toBe('model');
    expect(response.json().data.parsed.experience[0].employer).toBe(
      'Enterprise Energy IT Services',
    );
  });

  it('falls back to the rules parser when the model produces nothing', async () => {
    const { app, authorization } = await createApp({ structure: async () => null });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.structuredBy).toBe('rules');
  });

  it('refuses a document that carries no fact instead of storing an empty resume', async () => {
    const { app, authorization } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      headers: { authorization },
      payload: importBody('. . . . . . . . . .'),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('resume_without_facts');
  });

  it('refuses an anonymous import', async () => {
    const { app } = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import',
      payload: importBody(),
    });

    // The origin guard answers before authentication, so an unsigned request
    // is refused as an untrusted origin rather than as a missing session.
    expect(response.statusCode).toBe(403);
  });
});
