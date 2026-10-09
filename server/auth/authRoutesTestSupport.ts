import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CoachProvider } from '../providers/coachProvider';
import { AuthService, type AuthServiceOptions } from './authService';

export const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

export interface AuthRouteTestOptions {
  readonly release?: string;
  readonly logDestination?: { write(line: string): void };
}

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
      model: 'nemotron-test',
      responseId: 'response-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      result: {
        message: 'Уточним результат.',
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

export async function createApp(
  onPasswordReset?: (input: {
    email: string;
    displayName: string | null;
    token: string;
  }) => Promise<void>,
  searchVacancies?: Parameters<typeof buildApp>[0]['searchVacancies'],
  searchRemotive?: Parameters<typeof buildApp>[0]['searchRemotive'],
  authOptions: Partial<Omit<AuthServiceOptions, 'databasePath'>> = {},
  testOptions: AuthRouteTestOptions = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-auth-routes-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath, onPasswordReset, ...authOptions });
  await auth.seedAccounts(
    [
      {
        username: 'admin.test',
        password: 'admin-password-for-tests',
        role: 'admin',
      },
      {
        username: 'candidate.test',
        password: 'candidate-password-for-tests',
        role: 'candidate',
      },
    ],
    candidates,
  );
  const config = createTestConfig(directory, databasePath, authOptions, onPasswordReset, testOptions);
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore: candidates,
    authService: auth,
    serveStatic: false,
    ...(testOptions.logDestination ? { logDestination: testOptions.logDestination } : {}),
    ...(searchVacancies ? { searchVacancies } : {}),
    ...(searchRemotive ? { searchRemotive } : {}),
  });
  resources.push({ app, auth, candidates, directory });
  return app;
}

function createTestConfig(
  directory: string,
  databasePath: string,
  authOptions: Partial<Omit<AuthServiceOptions, 'databasePath'>>,
  onPasswordReset?: (input: { email: string; displayName: string | null; token: string }) => Promise<void>,
  testOptions: AuthRouteTestOptions = {},
): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 3210,
    openAIKey: 'not-used-by-test',
    openRouterKey: 'not-used-by-test',
    previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
    dataEncryptionKey: Buffer.alloc(32, 8),
    databasePath,
    model: 'gpt-5.6-sol',
    staticRoot: directory,
    release: testOptions.release ?? 'test',
    logLevel: testOptions.logDestination ? 'warn' : 'fatal',
    secureCookies: false,
    emailVerificationRequired: authOptions.emailVerificationRequired ?? false,
    allowedOrigins: ['http://localhost:3000'],
    seedAccounts: [],
    ...(onPasswordReset
      ? {
          accountEmail: {
            apiKey: 'test-resend-key',
            from: 'openqareer <noreply@openqareer.test>',
            publicBaseUrl: 'http://localhost:3000',
          },
        }
      : {}),
  };
}

export async function login(
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
  password: string,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: {
      origin: 'http://localhost:3000',
    },
    payload: { username, password },
  });
  return {
    response,
    cookie: String(response.headers['set-cookie']).split(';')[0],
  };
}
