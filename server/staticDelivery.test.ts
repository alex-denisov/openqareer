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

async function createStaticApp() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-static-'));
  writeFileSync(
    join(directory, 'index.html'),
    '<!doctype html><title>current release</title>',
  );
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
    oauthProviders: {},
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
});
