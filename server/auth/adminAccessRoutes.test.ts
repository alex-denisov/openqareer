import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CandidateWorkspaceState } from '../domain/candidateWorkspace';
import type { CoachProvider } from '../providers/coachProvider';
import { AuthService } from './authService';

const ADMIN = { username: 'admin.test', password: 'admin-password-for-tests' };
const CANDIDATE = { username: 'candidate.test', password: 'candidate-password-for-tests' };
const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

const provider: CoachProvider = {
  async createTurn() {
    throw new Error('Admin access tests must not call a language model.');
  },
};

async function createApp() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-admin-access-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({ databasePath, encryptionKey: Buffer.alloc(32, 8) });
  const auth = new AuthService({ databasePath });
  await auth.seedAccounts(
    [
      { ...ADMIN, role: 'admin' },
      { ...CANDIDATE, role: 'candidate' },
    ],
    candidates,
  );
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 3210,
    openAIKey: 'not-used-by-test',
    openRouterKey: 'not-used-by-test',
    previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
    dataEncryptionKey: Buffer.alloc(32, 8),
    databasePath,
    model: 'gpt-5.6-sol',
    staticRoot: directory,
    release: 'test',
    logLevel: 'fatal',
    secureCookies: false,
    allowedOrigins: ['http://localhost:3000'],
    seedAccounts: [],
  };
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    serveStatic: false,
    searchVacancies: async () => ({
      source: 'hh',
      query: 'Frontend',
      found: 0,
      fetchedAt: new Date().toISOString(),
      items: [],
    }),
  });
  resources.push({ app, auth, candidates, directory });
  return app;
}

async function signIn(
  app: Awaited<ReturnType<typeof buildApp>>,
  account: { username: string; password: string },
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:3000' },
    payload: account,
  });
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0];
}

async function register(
  app: Awaited<ReturnType<typeof buildApp>>,
  displayName: string,
  email: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: 'http://localhost:3000' },
    payload: {
      displayName,
      email,
      password: 'candidate-password-for-tests',
      legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: string; username: string };
}

async function userIdFor(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
  username: string,
): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/admin/users?query=${encodeURIComponent(username)}`,
    headers: { cookie: adminCookie },
  });
  return response.json().data.users[0].id as string;
}

async function careerPartner(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
  displayName: string,
  email: string,
): Promise<string> {
  const account = await register(app, displayName, email);
  const id = await userIdFor(app, adminCookie, account.username);
  const response = await app.inject({
    method: 'PATCH',
    url: `/api/v1/admin/users/${id}`,
    headers: { cookie: adminCookie },
    payload: { role: 'CareerPartner' },
  });
  expect(response.statusCode).toBe(200);
  return id;
}

async function assignCandidate(
  app: Awaited<ReturnType<typeof buildApp>>,
  adminCookie: string,
  partnerId: string,
  candidateId: string,
) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/admin/users/${partnerId}/partner-assignments`,
    headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
    payload: { candidateUserId: candidateId },
  });
}

function campaignWorkspace(): CandidateWorkspaceState {
  return {
    resumeText: '',
    resumeSource: 'text',
    targetDirection: 'VP Technology Ops',
    regions: ['ru'],
    currentSituation: '',
    constraints: '',
    urgency: 'active',
  };
}

describe('admin access control', () => {
  it('restores a CareerPartner role on the next authenticated request', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const partner = await register(app, 'Консультант', 'partner@example.com');
    const partnerId = await userIdFor(app, adminCookie, partner.username);
    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${partnerId}`,
      headers: { cookie: adminCookie },
      payload: { role: 'CareerPartner' },
    });
    expect(changed.json().data).toMatchObject({ role: 'CareerPartner', candidateId: null });
    const partnerCookie = await signIn(app, {
      username: partner.username,
      password: 'candidate-password-for-tests',
    });
    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: partnerCookie },
    });
    expect(session.json().data.role).toBe('CareerPartner');
  }, 15_000);

  it('keeps existing administrator permissions enabled by default', async () => {
    const app = await createApp();
    const cookie = await signIn(app, ADMIN);
    const adminId = await userIdFor(app, cookie, ADMIN.username);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users/${adminId}/permissions`,
      headers: { cookie },
    });
    expect(Object.values(response.json().data.permissions)).toEqual([true, true, true, true]);
  });

  it('persists one explicit override and audits who changed it for whom', async () => {
    const app = await createApp();
    const cookie = await signIn(app, ADMIN);
    const partnerId = await careerPartner(
      app,
      cookie,
      'Партнёр',
      'partner-permissions@example.com',
    );
    const before = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users/${partnerId}/permissions`,
      headers: { cookie },
    });
    expect(before.json().data.permissions).toMatchObject({
      can_view_candidates: true,
      can_edit_campaigns: false,
      can_manage_pool: false,
      can_view_audit: false,
    });
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${partnerId}/permissions`,
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { permission: 'can_view_audit', enabled: true },
    });
    expect(saved.json().data.overrides.can_view_audit).toBe(true);
    const after = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users/${partnerId}/permissions`,
      headers: { cookie },
    });
    expect(after.json().data.permissions.can_view_audit).toBe(true);
    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit?action=change_user_permission&limit=10',
      headers: { cookie },
    });
    expect(audit.json().data.records[0]).toMatchObject({
      actorUsername: ADMIN.username,
      subjectUserId: partnerId,
      action: 'change_user_permission',
    });
    expect(audit.json().data.records[0].detail).toContain('can_view_audit');
  }, 15_000);

  it('opens audit to a CareerPartner only after an explicit grant', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const partnerId = await careerPartner(
      app,
      adminCookie,
      'Консультант аудита',
      'partner-audit@example.com',
    );
    const partnerCookie = await signIn(app, {
      username: 'partner-audit@example.com',
      password: 'candidate-password-for-tests',
    });
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: { cookie: partnerCookie },
    });
    expect(denied.statusCode).toBe(403);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${partnerId}/permissions`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
      payload: { permission: 'can_view_audit', enabled: true },
    });
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: { cookie: partnerCookie },
    });
    expect(allowed.statusCode).toBe(200);
  }, 15_000);

  it('requires can_edit_campaigns before changing an assigned candidate campaign', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const partnerId = await careerPartner(
      app,
      adminCookie,
      'Партнёр',
      'campaign-partner@example.com',
    );
    const candidateId = await userIdFor(app, adminCookie, CANDIDATE.username);
    expect((await assignCandidate(app, adminCookie, partnerId, candidateId)).statusCode).toBe(201);
    const resource = resources.at(-1);
    const candidate = resource?.auth.getUser(candidateId);
    if (!resource || !candidate?.candidateId) throw new Error('Candidate fixture was not created.');
    resource.candidates.saveCandidateWorkspace(candidate.candidateId, campaignWorkspace());
    const partnerCookie = await signIn(app, {
      username: 'campaign-partner@example.com',
      password: 'candidate-password-for-tests',
    });
    const payload = { roles: ['COO'], regions: ['eu'], remoteOnly: true };
    const denied = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/partner/candidates/${candidateId}/campaign`,
      headers: { cookie: partnerCookie, origin: 'http://localhost:3000' },
      payload,
    });
    expect(denied.statusCode).toBe(403);
    const permissions = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${partnerId}/permissions`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000' },
      payload: { permission: 'can_edit_campaigns', enabled: true },
    });
    expect(permissions.statusCode).toBe(200);
    const changed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/partner/candidates/${candidateId}/campaign`,
      headers: { cookie: partnerCookie, origin: 'http://localhost:3000' },
      payload,
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.roles.value).toEqual(['COO']);
    expect(changed.json().data.remoteOnly).toBe(true);
  }, 15_000);

  it('protects the last active SuperAdmin from removing their own rights', async () => {
    const app = await createApp();
    const cookie = await signIn(app, ADMIN);
    const adminId = await userIdFor(app, cookie, ADMIN.username);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${adminId}/permissions`,
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { permission: 'can_view_candidates', enabled: false },
    });
    expect(response.statusCode).toBe(409);
    const roleChange = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${adminId}`,
      headers: { cookie },
      payload: { role: 'CareerPartner' },
    });
    expect(roleChange.statusCode).toBe(409);
  });

  it('clears explicit partner permissions when the account role changes', async () => {
    const app = await createApp();
    const cookie = await signIn(app, ADMIN);
    const partnerId = await careerPartner(app, cookie, 'Партнёр', 'partner-role-reset@example.com');
    const grant = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${partnerId}/permissions`,
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { permission: 'can_manage_pool', enabled: true },
    });
    expect(grant.json().data.permissions.can_manage_pool).toBe(true);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${partnerId}`,
      headers: { cookie },
      payload: { role: 'candidate' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/users/${partnerId}`,
      headers: { cookie },
      payload: { role: 'CareerPartner' },
    });
    const permissions = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users/${partnerId}/permissions`,
      headers: { cookie },
    });
    expect(permissions.json().data.permissions.can_manage_pool).toBe(false);
    expect(permissions.json().data.overrides).toEqual({});
  }, 15_000);

  it('assigns candidates and limits partner profile reads to assigned IDs', async () => {
    const app = await createApp();
    const adminCookie = await signIn(app, ADMIN);
    const partnerId = await careerPartner(app, adminCookie, 'Партнёр', 'partner-scope@example.com');
    const assignedId = await userIdFor(app, adminCookie, CANDIDATE.username);
    const unassigned = await register(app, 'Без закрепления', 'unassigned@example.com');
    const unassignedId = await userIdFor(app, adminCookie, unassigned.username);
    expect((await assignCandidate(app, adminCookie, partnerId, assignedId)).statusCode).toBe(201);
    const assignments = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/users/${partnerId}/partner-assignments`,
      headers: { cookie: adminCookie },
    });
    expect(assignments.json().data.items).toHaveLength(1);
    const partnerCookie = await signIn(app, {
      username: 'partner-scope@example.com',
      password: 'candidate-password-for-tests',
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/partner/candidates',
      headers: { cookie: partnerCookie },
    });
    expect(list.json().data.items.map((item: { userId: string }) => item.userId)).toEqual([
      assignedId,
    ]);
    const profile = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/partner/candidates/${assignedId}`,
      headers: { cookie: partnerCookie },
    });
    expect(profile.json().data).toHaveProperty('resume');
    expect(profile.json().data.applications).toHaveProperty('funnel');
    const idor = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/partner/candidates/${unassignedId}`,
      headers: { cookie: partnerCookie },
    });
    expect(idor.statusCode).toBe(404);
    const directory = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: { cookie: partnerCookie },
    });
    expect(directory.statusCode).toBe(403);
    expect(directory.body).not.toContain('unassigned@example.com');
  }, 20_000);
});
