import { afterEach } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import type { CoachProvider } from './providers/coachProvider';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { SessionAuth } from './auth/authService';

export const config: ServerConfig = {
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
  oauthProviders: {},
};

export const noSessions: SessionAuth = {
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

export const successProvider: CoachProvider = {
  async createTurn() {
    return {
      provider: 'openai',
      model: 'gpt-5.6-sol',
      responseId: 'response-1',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      result: {
        message: 'Уточним результат запуска.',
        phase: 'evidence',
        memoryCandidates: [],
        nextQuestion: 'Что изменилось после запуска?',
        completeness: {
          known: ['Есть опыт запуска'],
          unknown: ['Наблюдаемый результат'],
        },
        safety: {
          needsHuman: false,
          reason: null,
        },
        careerTrack: null,
        actionProposals: [],
      },
    };
  },
};

export const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
export const stores: SqliteCandidateStore[] = [];
export const candidateTokens = new WeakMap<Awaited<ReturnType<typeof buildApp>>, string>();

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  stores.splice(0).forEach((store) => store.close());
});

export async function createApp(
  provider: CoachProvider = successProvider,
  searchVacancies?: Parameters<typeof buildApp>[0]['searchVacancies'],
  importProfile?: Parameters<typeof buildApp>[0]['importProfile'],
) {
  const candidateStore = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: config.dataEncryptionKey,
  });
  const candidate = candidateStore.createCandidate({
    dataClass: 'synthetic',
    locale: 'ru-RU',
  });
  const app = await buildApp({
    config,
    coachProvider: provider,
    candidateStore,
    authService: noSessions,
    serveStatic: false,
    searchVacancies,
    importProfile,
  });
  apps.push(app);
  stores.push(candidateStore);
  candidateTokens.set(app, candidate.accessToken);
  return app;
}

export const validPayload = {
  messageId: '85512ddf-962c-4a7c-a4cc-30a35d1e5847',
  content: 'Я запускал цифровой продукт.',
  phase: 'discovery',
};

export function candidateAuthorization(app: Awaited<ReturnType<typeof buildApp>>): string {
  return `Bearer ${candidateTokens.get(app)}`;
}

