import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { SessionAuth } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  directory: string;
  store: SqliteCandidateStore;
}> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.store.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

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

const provider: CoachProvider = {
  async createTurn() {
    throw new Error('not_used');
  },
};

async function createStaticApp(
  options: { adminDocument?: boolean; legalDocuments?: boolean } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-static-'));
  writeFileSync(
    join(directory, 'index.html'),
    '<!doctype html><title>current release</title>',
  );
  if (options.legalDocuments !== false) {
    writeFileSync(
      join(directory, 'legal-privacy.html'),
      '<!doctype html><title>Политика обработки персональных данных · OpenQareer</title>',
    );
  }
  if (options.adminDocument !== false) {
    writeFileSync(
      join(directory, 'admin.html'),
      '<!doctype html><title>administrator console</title>',
    );
  }
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: Buffer.alloc(32, 5),
  });
  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 3210,
    openAIKey: 'not-used-by-test',
    openRouterKey: 'not-used-by-test',
    previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
    dataEncryptionKey: Buffer.alloc(32, 5),
    databasePath: ':memory:',
    model: 'gpt-5.6-sol',
    staticRoot: directory,
    release: 'release-current',
    logLevel: 'fatal',
    secureCookies: false,
    allowedOrigins: ['http://localhost:3000'],
    seedAccounts: [],
  };
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: store,
    authService: noSessions,
  });
  resources.push({ app, directory, store });
  return app;
}

describe('static release delivery', () => {
  it('never validates entry HTML with a release-agnostic ETag', async () => {
    const app = await createStaticApp();
    const first = await app.inject({ method: 'GET', url: '/' });

    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toBeUndefined();
    expect(first.headers['last-modified']).toBeUndefined();
    expect(first.headers['cache-control']).toContain('no-store');

    const conditional = await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'if-none-match': 'W/"283-0"' },
    });

    expect(conditional.statusCode).toBe(200);
    expect(conditional.body).toContain('current release');
  });

  /**
   * B089 — the administrator deep link used to receive the workspace document,
   * so the console's visitors watched the candidate cabinet for seconds while
   * the bundle arrived. Each surface now answers with its own first paint.
   */
  it('answers the administrator deep link with the administrator document', async () => {
    const app = await createStaticApp();

    for (const url of ['/admin', '/admin/', '/admin/users?query=maria']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain('administrator console');
      expect(response.body, url).not.toContain('current release');
    }
  });

  it('keeps every other deep link on the workspace document', async () => {
    const app = await createStaticApp();

    for (const url of ['/', '/career', '/administrators', '/adminsomething']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(200);
      expect(response.body, url).toContain('current release');
    }
  });

  /**
   * B168 / INC-026 — a build-output path either exists in this release or it
   * does not. Answering a missing `/assets/*` with the entry document made the
   * split-bundle loader read an HTML page as a bundle part and dead-end on
   * "bad part length", which is what the owner saw on `/admin`. The same
   * substitution is the archived INC-018 defect.
   */
  it('answers a missing build asset with 404 instead of the entry document', async () => {
    const app = await createStaticApp();

    for (const url of [
      '/assets/index-Cl6oP_Oi.js.split.js.oqpart-999.js',
      '/assets/index-DEADBEEF.js',
      '/assets/index-DEADBEEF.css',
      '/assets/nested/thing.js?v=2',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
      expect(response.body, url).not.toContain('current release');
      expect(response.body, url).not.toContain('administrator console');
    }
  });

  it('falls back to the workspace document when the release has no admin one', async () => {
    const app = await createStaticApp({ adminDocument: false });

    const response = await app.inject({ method: 'GET', url: '/admin' });

    // A release built before this split must keep serving a working route
    // rather than 404 a page that used to load.
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('current release');
  });

  /**
   * B173 — a legal deep link must reach the prerendered document, so a crawler
   * reads the text instead of the workspace bootstrap.
   */
  it('answers a legal deep link with that document, not the workspace shell', async () => {
    const app = await createStaticApp();

    const response = await app.inject({ method: 'GET', url: '/legal/privacy' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Политика обработки персональных данных');
    expect(response.body).not.toContain('current release');
  });

  it('falls back to the workspace document when the legal page was not built', async () => {
    const app = await createStaticApp({ legalDocuments: false });

    const response = await app.inject({ method: 'GET', url: '/legal/privacy' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('current release');
  });

  it('does not invent a document for a slug the pack does not publish', async () => {
    const app = await createStaticApp();

    const response = await app.inject({ method: 'GET', url: '/legal/offer' });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('current release');
  });
});
