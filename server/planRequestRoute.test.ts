import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import { AuthService } from './auth/authService';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from './vacancies/memoryVacancyPoolStore';
import type { VacancyCluster } from './domain/unifiedVacancy';

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  directory: string;
}> = [];

const dummyProvider: CoachProvider = {
  async createTurn() {
    throw new Error('not_used');
  },
};

afterEach(async () => {
  for (const r of resources.splice(0)) {
    await r.app.close();
    r.auth.close();
    r.candidates.close();
    rmSync(r.directory, { recursive: true, force: true });
  }
});

async function createApp(clusters: VacancyCluster[] = [], options: { persisted?: boolean } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-plan-requests-'));
  const databasePath = join(directory, 'app.db');
  const candidates = new SqliteCandidateStore({
    databasePath,
    encryptionKey: Buffer.alloc(32, 8),
  });
  const auth = new AuthService({ databasePath });
  await auth.seedAccounts(
    [
      {
        username: 'candidate.pitch',
        password: 'candidate-pitch-password',
        role: 'candidate',
      },
    ],
    candidates,
  );

  const poolStore = new MemoryVacancyPoolStore();
  const multiSourceEngine = new MultiSourceVacancyEngine({
    pool: poolStore,
    recluster: { mode: 'sync' },
  });

  if (options.persisted) {
    // Прод (B229/B230): кластеры лежат на диске, в куче процесса их нет, и
    // любой `loadClusters()` — это чтение всего пула на минуты (память
    // «prod-full-pool-read-costs-minutes»). Отклик по одной вакансии обязан
    // читать один кластер.
    poolStore.saveClusters(clusters);
    poolStore.loadClusters = () => {
      throw new Error('full cluster hydration on a single-vacancy request');
    };
  } else if (clusters.length > 0) {
    (multiSourceEngine as unknown as { clusters: VacancyCluster[] }).clusters = clusters;
  }

  const config: ServerConfig = {
    host: '127.0.0.1',
    port: 3210,
    openAIKey: 'not-used',
    openRouterKey: 'not-used',
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
    coachProvider: dummyProvider,
    candidateStore: candidates,
    authService: auth,
    multiSourceVacancyEngine: multiSourceEngine,
    serveStatic: false,
  });

  resources.push({ app, auth, candidates, directory });
  return { app, candidates, multiSourceEngine };
}

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:3000' },
    payload: {
      username: 'candidate.pitch',
      password: 'candidate-pitch-password',
    },
  });
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  const candidateId = response.json().data.candidateId;
  return { cookie, candidateId };
}

describe('plan requests (B266)', () => {
  it('requires a signed-in candidate', async () => {
    const { app } = await createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/plan-requests',
      headers: { origin: 'http://localhost:3000' },
      payload: { planId: 'consultant' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('stores one request per plan and lists it back', async () => {
    const { app } = await createApp();
    const { cookie } = await login(app);
    const send = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/candidate/plan-requests',
        headers: { origin: 'http://localhost:3000', cookie },
        payload: { planId: 'consultant', note: 'Хочу разбор профиля' },
      });
    const first = await send();
    const second = await send();
    expect(first.statusCode).toBe(200);
    expect(second.json().data.createdAt).toBe(first.json().data.createdAt);
    const list = await app.inject({ method: 'GET', url: '/api/v1/candidate/plan-requests', headers: { cookie } });
    expect(list.json().data).toEqual([{ planId: 'consultant', createdAt: first.json().data.createdAt }]);
  });

  it('rejects an unknown plan and a foreign origin', async () => {
    const { app } = await createApp();
    const { cookie } = await login(app);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/plan-requests',
      headers: { origin: 'http://localhost:3000', cookie },
      payload: { planId: 'free-lunch' },
    });
    expect(bad.statusCode).toBe(400);
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/plan-requests',
      headers: { origin: 'https://evil.example', cookie },
      payload: { planId: 'consultant' },
    });
    expect(foreign.statusCode).toBe(403);
  });
});
