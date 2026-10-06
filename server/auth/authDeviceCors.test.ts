import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CoachProvider } from '../providers/coachProvider';
import { AuthService } from './authService';

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

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

describe('auth device identity CORS', () => {
  it('allows the device identity header in auth preflight requests', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-device-cors-'));
    const databasePath = join(directory, 'app.db');
    const candidates = new SqliteCandidateStore({
      databasePath,
      encryptionKey: Buffer.alloc(32, 8),
    });
    const auth = new AuthService({ databasePath });
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

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/auth/login',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-openqareer-device-id',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-headers']).toContain(
      'X-OpenQareer-Device-Id',
    );
  });
});
