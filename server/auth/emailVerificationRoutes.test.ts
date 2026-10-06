import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { AuthService } from './authService';
import type { CoachProvider } from '../providers/coachProvider';
import { LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';

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
    return {
      provider: 'openrouter',
      model: 'verification-test',
      responseId: 'response-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      result: {
        message: 'Продолжим.',
        phase: 'evidence',
        memoryCandidates: [],
        nextQuestion: 'Что изменилось?',
        completeness: { known: [], unknown: [] },
        safety: { needsHuman: false, reason: null },
        careerTrack: null,
        actionProposals: [],
      },
    };
  },
};

async function createVerificationApp(deliveries: Array<{ code: string }>) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-email-verification-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({
    databasePath,
    emailVerificationRequired: true,
    emailVerificationHashKey: Buffer.alloc(32, 23),
    emailVerificationFixedCode: '123456',
    emailMxCheckBypassDomains: ['example.com'],
    onEmailVerification: async ({ code }) => { deliveries.push({ code }); },
  });
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
    emailVerificationRequired: true,
    allowedOrigins: ['http://localhost:3000'],
    seedAccounts: [],
    accountEmail: {
      apiKey: 'test-resend-key',
      from: 'openqareer <noreply@openqareer.test>',
      publicBaseUrl: 'http://localhost:3000',
    },
  };
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    serveStatic: false,
  });
  resources.push({ app, auth, candidates, directory });
  return app;
}

describe('email verification routes (B398)', () => {
  it('blocks candidate access until the registered address is verified', async () => {
    const deliveries: Array<{ code: string }> = [];
    const app = await createVerificationApp(deliveries);
    const registered = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'new.candidate@example.com',
        displayName: 'Новый кандидат',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });
    const cookie = String(registered.headers['set-cookie']).split(';')[0];

    expect(registered.statusCode).toBe(201);
    expect(registered.json().data.emailVerified).toBe(false);
    expect(deliveries).toEqual([{ code: '123456' }]);

    const accountBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/account',
      headers: { cookie },
    });
    const cabinetBefore = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { cookie },
    });
    expect(accountBefore.statusCode).toBe(403);
    expect(accountBefore.json().error.code).toBe('email_unverified');
    expect(cabinetBefore.statusCode).toBe(403);
    expect(cabinetBefore.json().error.code).toBe('email_unverified');

    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/email-verification/verify',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { code: '123456' },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().data.emailVerified).toBe(true);

    const cabinetAfter = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { cookie },
    });
    expect(cabinetAfter.statusCode).toBe(200);
  });
});
