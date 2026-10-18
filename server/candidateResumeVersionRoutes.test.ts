import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 3210,
  openAIKey: 'not-used-by-test',
  openRouterKey: 'not-used-by-test',
  previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
  dataEncryptionKey: Buffer.alloc(32, 7),
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
    throw new Error('resume version and ATS routes must not call a model');
  },
};

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
  const otherCandidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const draft = {
    ...EMPTY_RESUME_DRAFT,
    candidate: {
      ...EMPTY_RESUME_DRAFT.candidate,
      fullName: 'Mila Example',
      contact: {
        email: 'mila@example.test',
        phone: '+49 000 000000',
        location: 'Berlin',
        links: [],
      },
    },
  };
  store.saveResumeDraft(candidate.id, draft, []);
  const app = await buildApp({
    config,
    coachProvider: unusedProvider,
    candidateStore: store,
    authService: noSessions,
    serveStatic: false,
  });
  apps.push(app);
  stores.push(store);
  return {
    app,
    store,
    candidateId: candidate.id,
    authorization: 'Bearer ' + candidate.accessToken,
    otherAuthorization: 'Bearer ' + otherCandidate.accessToken,
  };
}

function headers(authorization: string, idempotencyKey?: string) {
  return {
    authorization,
    origin: 'http://localhost:3000',
    ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
  };
}

describe('candidate resume version approval API', () => {
  it('creates a draft, approves only the unchanged snapshot, reloads it, and returns edits to draft', async () => {
    const { app, authorization } = await createApp();
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions?limit=20',
      headers: headers(authorization),
    });
    const masterRevision = list.json().data.currentMasterRevision as string;
    const versionId = randomUUID();
    const initial = {
      title: 'Platform Engineer',
      requirements: ['Kubernetes', 'Terraform'],
      expectedMasterRevision: masterRevision,
    };
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization, versionId),
      payload: initial,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.version).toMatchObject({ status: 'draft', revision: 1 });

    const approved = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
      payload: {
        ...initial,
        expectedRevision: 1,
        status: 'approved',
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.headers.etag).toBe('"resume-version-' + versionId + '-r2"');
    expect(approved.json().data.version).toMatchObject({
      id: versionId,
      status: 'approved',
      revision: 2,
      title: initial.title,
      requirements: initial.requirements,
    });
    expect(approved.json().data.version.snapshot).toEqual(created.json().data.version.snapshot);

    const opened = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().data.version.status).toBe('approved');
    expect(opened.json().data.version.snapshot).toEqual(created.json().data.version.snapshot);

    const edited = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
      payload: {
        title: 'Platform Engineer II',
        requirements: ['Kubernetes'],
        expectedRevision: 2,
        expectedMasterRevision: masterRevision,
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data.version).toMatchObject({
      status: 'draft',
      revision: 3,
      title: 'Platform Engineer II',
      requirements: ['Kubernetes'],
    });

    const reloaded = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
    });
    expect(reloaded.statusCode).toBe(200);
    expect(reloaded.json().data.version).toMatchObject({
      status: 'draft',
      revision: 3,
    });

    const reloadedList = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions?limit=20',
      headers: headers(authorization),
    });
    expect(reloadedList.json().data.items).toContainEqual(
      expect.objectContaining({ id: versionId, status: 'draft', revision: 3 }),
    );
  });

  it('rejects stale and changed-snapshot approval attempts without changing the draft', async () => {
    const { app, authorization } = await createApp();
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions?limit=20',
      headers: headers(authorization),
    });
    const masterRevision = list.json().data.currentMasterRevision as string;
    const versionId = randomUUID();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization, versionId),
      payload: {
        title: 'Platform Engineer',
        requirements: ['Kubernetes'],
        expectedMasterRevision: masterRevision,
      },
    });
    expect(created.statusCode).toBe(201);

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
      payload: {
        title: 'Platform Engineer II',
        requirements: ['Kubernetes'],
        expectedRevision: 1,
        expectedMasterRevision: masterRevision,
      },
    });
    expect(updated.statusCode).toBe(200);

    const staleApproval = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
      payload: {
        title: 'Platform Engineer II',
        requirements: ['Kubernetes'],
        expectedRevision: 1,
        expectedMasterRevision: masterRevision,
        status: 'approved',
      },
    });
    expect(staleApproval.statusCode).toBe(409);
    expect(staleApproval.json().error.code).toBe('resume_version_conflict');

    const changedApproval = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
      payload: {
        title: 'Changed after review',
        requirements: ['Kubernetes'],
        expectedRevision: 2,
        expectedMasterRevision: masterRevision,
        status: 'approved',
      },
    });
    expect(changedApproval.statusCode).toBe(409);
    expect(changedApproval.json().error.code).toBe('resume_version_conflict');

    const sendClaim = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
      payload: {
        title: 'Platform Engineer II',
        requirements: ['Kubernetes'],
        expectedRevision: 2,
        expectedMasterRevision: masterRevision,
        status: 'sent',
      },
    });
    expect(sendClaim.statusCode).toBe(400);
    expect(sendClaim.json().error.code).toBe('invalid_resume_version_input');

    const unchanged = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
    });
    expect(unchanged.json().data.version).toMatchObject({
      status: 'draft',
      revision: 2,
      title: 'Platform Engineer II',
    });
  });
});

describe('candidate resume version and ATS APIs', () => {
  it('creates, lists, opens, edits, and reloads a real targeted snapshot', async () => {
    const { app, authorization } = await createApp();
    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions?limit=20',
      headers: headers(authorization),
    });
    expect(listBefore.statusCode).toBe(200);
    expect(listBefore.json().data.totalCount).toBe(0);
    const sourceMasterRevision = listBefore.json().data.currentMasterRevision as string;
    const versionId = randomUUID();
    const body = {
      title: 'Platform Engineer',
      requirements: ['Kubernetes', 'Terraform'],
      expectedMasterRevision: sourceMasterRevision,
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization, versionId),
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.location).toBe('/api/v1/candidate/resume/versions/' + versionId);
    expect(created.json().data.version).toMatchObject({
      id: versionId,
      title: 'Platform Engineer',
      status: 'draft',
      revision: 1,
      requirements: ['Kubernetes', 'Terraform'],
    });
    expect(created.json().data.version.snapshot.document.kind).toBe('master');
    expect(created.json().data.version.snapshot.missingRequirements).toContain('Kubernetes');

    const opened = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
    });
    expect(opened.statusCode).toBe(200);
    expect(opened.json().data.version.snapshot).toEqual(created.json().data.version.snapshot);

    const updated = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
      payload: {
        title: 'Platform Engineer II',
        requirements: ['Kubernetes'],
        expectedRevision: 1,
        expectedMasterRevision: sourceMasterRevision,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.version).toMatchObject({
      title: 'Platform Engineer II',
      requirements: ['Kubernetes'],
      revision: 2,
    });

    const reloadedList = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions?limit=20',
      headers: headers(authorization),
    });
    expect(reloadedList.json().data.totalCount).toBe(1);
    expect(reloadedList.json().data.items).toContainEqual(
      expect.objectContaining({
        id: versionId,
        title: 'Platform Engineer II',
        revision: 2,
      }),
    );

    const staleEdit = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(authorization),
      payload: {
        title: 'Stale edit',
        requirements: ['Kubernetes'],
        expectedRevision: 1,
        expectedMasterRevision: sourceMasterRevision,
      },
    });
    expect(staleEdit.statusCode).toBe(409);
    expect(staleEdit.json().error.code).toBe('resume_version_conflict');
  });

  it('rejects create and edit requests against a stale master baseline', async () => {
    const { app, store, candidateId, authorization } = await createApp();
    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization),
    });
    const oldMasterRevision = listBefore.json().data.currentMasterRevision as string;

    store.saveResumeDraft(
      candidateId,
      { ...EMPTY_RESUME_DRAFT, targetRole: 'Site Reliability Engineer' },
      [],
    );
    const staleCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization, randomUUID()),
      payload: {
        title: 'Platform Engineer',
        requirements: ['Kubernetes'],
        expectedMasterRevision: oldMasterRevision,
      },
    });
    expect(staleCreate.statusCode).toBe(409);
    expect(staleCreate.json().error.code).toBe('resume_source_changed');
  });

  it('isolates versions by candidate and returns not found for another candidate', async () => {
    const { app, authorization, otherAuthorization } = await createApp();
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization),
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization, randomUUID()),
      payload: {
        title: 'Private Candidate Target',
        requirements: ['Kubernetes'],
        expectedMasterRevision: list.json().data.currentMasterRevision,
      },
    });
    const versionId = created.json().data.version.id as string;

    const otherRead = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(otherAuthorization),
    });
    expect(otherRead.statusCode).toBe(404);
    expect(otherRead.json().error.code).toBe('resume_version_not_found');

    const otherApproval = await app.inject({
      method: 'PUT',
      url: '/api/v1/candidate/resume/versions/' + versionId,
      headers: headers(otherAuthorization),
      payload: {
        title: 'Private Candidate Target',
        requirements: ['Kubernetes'],
        expectedRevision: 1,
        expectedMasterRevision: created.json().data.currentMasterRevision,
        status: 'approved',
      },
    });
    expect(otherApproval.statusCode).toBe(404);
    expect(otherApproval.json().error.code).toBe('resume_version_not_found');
  });

  it('returns partial ATS findings without inventing keyword or total scores', async () => {
    const { app, authorization, store, candidateId } = await createApp();
    const emptyContext = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/ats-assessment',
      headers: headers(authorization),
      payload: {},
    });
    expect(emptyContext.statusCode).toBe(200);
    expect(emptyContext.json().data.assessment.total).toEqual({
      score: null,
      maximum: 100,
      status: 'partial',
    });
    expect(emptyContext.json().data.assessment.dimensions.keywords.status).toBe('unknown');
    expect(emptyContext.json().data.assessment.dimensions.structure.source).toBe('Мастер-резюме');

    store.saveResumeDraft(
      candidateId,
      { ...EMPTY_RESUME_DRAFT, targetRole: 'Platform Engineer' },
      [],
    );
    const roleOnly = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/ats-assessment',
      headers: headers(authorization),
      payload: {},
    });
    expect(roleOnly.statusCode).toBe(200);
    expect(roleOnly.json().data.assessment.context.requirementSource).toBeNull();
    expect(roleOnly.json().data.assessment.dimensions.keywords.status).toBe('unknown');

    const sourced = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/ats-assessment',
      headers: headers(authorization),
      payload: {
        title: 'Platform Engineer',
        requirements: ['Platform Engineer'],
      },
    });
    expect(sourced.statusCode).toBe(200);
    expect(sourced.json().data.assessment.context.requirementSource).toMatchObject({
      kind: 'candidate_input',
      label: 'Platform Engineer',
    });
    expect(sourced.json().data.assessment.evaluatedAt).toEqual(expect.any(String));
    expect(sourced.json().data.assessment.dimensions.keywords.sampleSize).toBe(1);
  });

  it('bounds version and ATS inputs before building snapshots', async () => {
    const { app, authorization } = await createApp();
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization),
    });
    const tooLongTitle = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/versions',
      headers: headers(authorization, randomUUID()),
      payload: {
        title: 'x'.repeat(161),
        requirements: ['Kubernetes'],
        expectedMasterRevision: list.json().data.currentMasterRevision,
      },
    });
    expect(tooLongTitle.statusCode).toBe(400);

    const tooManyRequirements = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/ats-assessment',
      headers: headers(authorization),
      payload: {
        title: 'Platform Engineer',
        requirements: Array.from({ length: 51 }, (_, index) => 'Requirement ' + index),
      },
    });
    expect(tooManyRequirements.statusCode).toBe(400);
  });
});
