import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CoachProvider } from '../providers/coachProvider';
import { LEGAL_PACK_VERSION_ID } from '../../shared/legalRegistry';
import { AuthService } from './authService';
import type { EmailDomainDnsFailure, EmailDomainResolver } from './emailDomainCheck';

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

const provider: CoachProvider = {
  async createTurn() {
    return {
      provider: 'openrouter',
      model: 'test',
      responseId: 'response-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      result: {
        message: 'Тестовый ответ.',
        phase: 'evidence',
        memoryCandidates: [],
        nextQuestion: 'Что изменилось?',
        completeness: { known: [], unknown: ['Результат'] },
        safety: { needsHuman: false, reason: null },
        careerTrack: null,
        actionProposals: [],
      },
    };
  },
};

const noDomainResolver: EmailDomainResolver = {
  async resolveMx() {
    throw Object.assign(new Error('domain not found'), { code: 'ENOTFOUND' });
  },
  async resolve4() {
    return [];
  },
  async resolve6() {
    return [];
  },
};

const transientFailureResolver: EmailDomainResolver = {
  async resolveMx() {
    throw Object.assign(new Error('DNS server failure'), { code: 'ESERVFAIL' });
  },
  async resolve4() {
    return [];
  },
  async resolve6() {
    return [];
  },
};

async function createTestApp(
  emailDomainResolver: EmailDomainResolver,
  onEmailDomainDnsFailure?: (failure: EmailDomainDnsFailure) => void,
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-email-domain-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({
    databasePath,
    emailDomainResolver,
    emailMxCheckBypassDomains: [],
    ...(onEmailDomainDnsFailure ? { onEmailDomainDnsFailure } : {}),
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
    allowedOrigins: ['http://localhost:3000'],
    seedAccounts: [],
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

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

describe('registration email domain validation', () => {
  it('returns 422 before creating a user when the domain has no mail route', async () => {
    const app = await createTestApp(noDomainResolver);

    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'candidate@unreachable.example.com',
        displayName: 'Candidate',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });

    expect(registration.statusCode).toBe(422);
    expect(registration.json().error).toMatchObject({ code: 'email_domain_unreachable' });
    expect(registration.json().error.message).toBe(
      'У этого адреса почта не принимается. Проверьте домен после @.',
    );

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:3000' },
      payload: { username: 'candidate', password: 'candidate-password-for-tests' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('allows registration after a temporary DNS failure and logs the failure code', async () => {
    const failures: EmailDomainDnsFailure[] = [];
    const app = await createTestApp(transientFailureResolver, (failure) => failures.push(failure));
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: 'candidate@temporary.example.com',
        displayName: 'Candidate',
        password: 'candidate-password-for-tests',
        legalConsent: { versionId: LEGAL_PACK_VERSION_ID },
      },
    });

    expect(registration.statusCode).toBe(201);
    expect(failures).toEqual([{ code: 'ESERVFAIL' }]);
  });
});
