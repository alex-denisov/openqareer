import { afterEach, describe, expect, it, vi } from 'vitest';
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

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const stores: SqliteCandidateStore[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
  vi.unstubAllGlobals();
});

async function createApp(resumeStructurer?: ResumeStructurer) {
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

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);

function fakeJpegFetch() {
  return vi.fn(async () => ({
    status: 200,
    type: 'basic',
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'image/jpeg' : null) },
    arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.byteLength),
  }));
}

function structuredBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2 as const,
    source: 'linkedin' as const,
    extractorVersion: 'li-sdui-1',
    sourceReceipt: {
      platform: 'linkedin' as const,
      accessMode: 'native_session_snapshot' as const,
      sourceUrl: 'https://www.linkedin.com/in/synthetic-candidate-731/',
      capturedAt: '2026-09-23T12:00:00.000Z',
    },
    profile: {
      fullName: 'Jordan Rivers',
      headline: 'VP of Technology & Operations',
      contact: { links: [] },
      experience: [
        {
          title: 'VP of Technology & Operations',
          employer: 'Northwind Labs',
          current: true,
          responsibilities: ['Leads the platform organisation.'],
          achievements: [],
        },
      ],
      skills: [],
      education: [],
      courses: [],
      tests: [],
      recommendations: [],
      languages: [],
    },
    ...overrides,
  };
}

describe('POST /api/v1/candidate/resume/import/structured (B265 slice 3)', () => {
  it('creates a v2 draft from a valid synthetic payload without ever calling the model', async () => {
    const { app, authorization } = await createApp({
      async structure() {
        throw new Error('importing a structured profile must not call the model');
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: structuredBody(),
    });

    expect(response.statusCode).toBe(200);
    const resume = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(resume.json().data.draft.schemaVersion).toBe(2);
    expect(resume.json().data.draft.candidate.headline).toBe('VP of Technology & Operations');
  });

  it('accepts the field paths the device dropped, and refuses values posing as paths (B266)', async () => {
    const { app, authorization } = await createApp();
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: structuredBody({ droppedFields: ['contact.email', 'skills', 'experience[].title', 'section:about'] }),
    });
    expect(accepted.statusCode).toBe(200);

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: structuredBody({ droppedFields: ['alexey@example.com is my email'] }),
    });
    expect(oversized.statusCode).toBe(422);
  });

  it('rejects a payload without schemaVersion: 2 (422 validation_failed, not 500)', async () => {
    const { app, authorization } = await createApp();
    const { schemaVersion: _drop, ...withoutVersion } = structuredBody();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: withoutVersion,
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects an unknown top-level profile field (rawText never belongs in v2)', async () => {
    const { app, authorization } = await createApp();
    const body = structuredBody();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: { ...body, profile: { ...body.profile, rawText: 'raw markup' } },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a photoSourceUrl outside media.licdn.com /dms/image/', async () => {
    const { app, authorization } = await createApp();
    const body = structuredBody();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: { ...body, profile: { ...body.profile, photoSourceUrl: 'https://evil.example/dms/image/x' } },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a contact link pointing at linkedin.com/safety/go (undecoded raw markup)', async () => {
    const { app, authorization } = await createApp();
    const body = structuredBody();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: {
        ...body,
        profile: {
          ...body.profile,
          contact: { links: ['https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fexample.com'] },
        },
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a non-https url anywhere a url is accepted', async () => {
    const { app, authorization } = await createApp();
    const body = structuredBody();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: {
        ...body,
        profile: { ...body.profile, contact: { links: ['http://example.com/insecure'] } },
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('fires resume_without_facts (422) when the structured profile carries no substance', async () => {
    const { app, authorization } = await createApp();
    const body = structuredBody({
      profile: {
        fullName: undefined,
        contact: { links: [] },
        experience: [],
        skills: [],
        education: [],
        courses: [],
        tests: [],
        recommendations: [],
        languages: [],
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: body,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('resume_without_facts');
  });

  it('is idempotent: the same profile and sourceUrl replay instead of duplicating facts', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const body = structuredBody();

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: body,
    });
    const memoryAfterFirst = store.getSnapshot(candidateId).memory.length;

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: { ...body, sourceReceipt: { ...body.sourceReceipt, capturedAt: '2026-09-23T13:00:00.000Z' } },
    });

    expect(replay.statusCode).toBe(200);
    expect(replay.json().meta.idempotentReplay).toBe(true);
    expect(store.getSnapshot(candidateId).memory).toHaveLength(memoryAfterFirst);
  });

  it('never writes work preferences from an openToWork suggestion', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const body = structuredBody({
      profile: {
        ...structuredBody().profile,
        openToWork: { roles: ['Product Manager'], locations: ['Berlin'], workplaceTypes: ['remote'] },
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: body,
    });

    expect(store.getWorkPreferenceRun(candidateId)).toBeNull();
    const resume = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(resume.json().data.draft.sourceSuggestions.openToWork).toEqual({
      roles: ['Product Manager'],
      locations: ['Berlin'],
      workplaceTypes: ['remote'],
    });
  });

  it('downloads a linked photo and serves it back only to its owner via GET /candidate/media/:mediaId', async () => {
    vi.stubGlobal('fetch', fakeJpegFetch());
    const { app, authorization } = await createApp();
    const body = structuredBody({
      profile: {
        ...structuredBody().profile,
        photoSourceUrl: 'https://media.licdn.com/dms/image/v2/photo/x?e=1',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: body,
    });

    const resume = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    const mediaId = resume.json().data.draft.candidate.photoMediaId;
    expect(typeof mediaId).toBe('string');

    const media = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/media/${mediaId}`,
      headers: { authorization },
    });
    expect(media.statusCode).toBe(200);
    expect(media.headers['content-type']).toBe('image/jpeg');
    expect(media.headers['cache-control']).toBe('private, max-age=86400');
    expect(media.headers.etag).toBe(mediaId);
    expect(media.headers['x-content-type-options']).toBe('nosniff');
  });

  it("serves 404, not another candidate's media, to a foreign session", async () => {
    vi.stubGlobal('fetch', fakeJpegFetch());
    const { app, store, authorization } = await createApp();
    const body = structuredBody({
      profile: {
        ...structuredBody().profile,
        photoSourceUrl: 'https://media.licdn.com/dms/image/v2/photo/x?e=1',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/import/structured',
      headers: { authorization },
      payload: body,
    });
    const resume = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    const mediaId = resume.json().data.draft.candidate.photoMediaId;
    const other = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });

    const media = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/media/${mediaId}`,
      headers: { authorization: `Bearer ${other.accessToken}` },
    });

    expect(media.statusCode).toBe(404);
  });

  it('returns 404 for an unknown mediaId', async () => {
    const { app, authorization } = await createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/media/does-not-exist',
      headers: { authorization },
    });
    expect(response.statusCode).toBe(404);
  });
});
