import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import { AuthService } from './auth/authService';
import { LEGAL_PACK_VERSION_ID } from '../shared/legalRegistry';

/**
 * B173 — a candidate hands the product a resume, so the product has to be able
 * to prove which documents they accepted and when. The acceptance is a
 * precondition of registration, not a banner.
 */

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
  databasePath: string;
}> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

const provider = {
  async createTurn() {
    throw new Error('not used');
  },
} as unknown as CoachProvider;

async function createApp() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-legal-consent-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath });
  const config = {
    port: 0,
    host: '127.0.0.1',
    databasePath,
    staticRoot: '/tmp/not-used',
    encryptionKey: Buffer.alloc(32, 8),
    allowedOrigins: ['http://localhost:3000'],
    secureCookies: false,
    sessionCookieName: 'openqareer_session',
  } as unknown as ServerConfig;
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    serveStatic: false,
  });
  resources.push({ app, auth, candidates, directory, databasePath });
  return { app, databasePath };
}

function register(
  app: Awaited<ReturnType<typeof buildApp>>,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin: 'http://localhost:3000' },
    payload,
  });
}

const CANDIDATE = {
  email: 'consent@example.com',
  displayName: 'Пётр Соколов',
  password: 'candidate-password-for-tests',
};

describe('legal consent at registration', () => {
  it('refuses a registration that did not accept the documents', async () => {
    const { app } = await createApp();

    const response = await register(app, CANDIDATE);

    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields.legalConsent).toContain('Примите');
  });

  it('refuses a registration that accepted a different version of the pack', async () => {
    const { app } = await createApp();

    const response = await register(app, {
      ...CANDIDATE,
      legalConsent: { versionId: 'legal-v0.9-2020-01-01' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.fields.legalConsent).toBeTruthy();
  });

  it('records the accepted version and the time of acceptance', async () => {
    const { app, databasePath } = await createApp();

    const response = await register(app, {
      ...CANDIDATE,
      legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
    });

    expect(response.statusCode).toBe(201);

    const database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database
      .prepare('SELECT user_id, version_id, documents, accepted_at FROM legal_consents')
      .all() as Array<{
      user_id: string;
      version_id: string;
      documents: string;
      accepted_at: string;
    }>;
    database.close();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.version_id).toBe(LEGAL_PACK_VERSION_ID);
    expect(JSON.parse(rows[0]?.documents ?? '[]')).toEqual([
      'terms',
      'privacy',
      'consent',
      'disclaimer',
    ]);
    expect(Number.isNaN(Date.parse(rows[0]?.accepted_at ?? ''))).toBe(false);
  });
});
