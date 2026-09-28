import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth/authService';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { buildApp } from './app';
import type { CoachProvider } from './providers/coachProvider';
import { HhVacancyDescriptionLoader } from './vacancies/hhVacancyDescription';
import { SqliteVacancyPoolStore } from './vacancies/sqliteVacancyPoolStore';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import type { UnifiedVacancy } from './domain/unifiedVacancy';

const resources: Array<{
  app: Awaited<ReturnType<typeof buildApp>>;
  auth: AuthService;
  candidates: SqliteCandidateStore;
  pool: SqliteVacancyPoolStore;
  directory: string;
}> = [];

const dummyProvider: CoachProvider = {
  async createTurn() {
    throw new Error('not_used');
  },
};

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.app.close();
    resource.auth.close();
    resource.candidates.close();
    resource.pool.close();
    rmSync(resource.directory, { recursive: true, force: true });
  }
});

async function signIn(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: 'http://localhost:3000' },
    payload: { username: 'candidate.b304', password: 'candidate-b304-password' },
  });
  return {
    cookie: String(response.headers['set-cookie']).split(';')[0],
    candidateId: response.json().data.candidateId as string,
  };
}

function vacancy(input: {
  id: string;
  sourceId: string;
  company: string;
  url: string;
  publishedAt: string;
  requiredSkills: string[];
}): UnifiedVacancy {
  return {
    id: input.id,
    fingerprint: input.id,
    title: 'Quality Engineer',
    company: input.company,
    location: 'Remote',
    description: 'Quality Engineer role',
    requiredSkills: input.requiredSkills,
    isRemote: true,
    url: input.url,
    provenance: {
      sourceType: 'json_api',
      sourceId: input.sourceId,
      sourceUrl: input.url,
      observedAt: input.publishedAt,
    },
    publishedAt: input.publishedAt,
    status: 'active',
  };
}

describe('GET /api/v1/candidate/matched-vacancies description preload (B304)', () => {
  it('stores skills and full descriptions for hh.ru vacancies in the first 20 results, beyond the first response page', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-b304-preload-'));
    const databasePath = join(directory, 'app.db');
    const encryptionKey = Buffer.alloc(32, 8);
    const candidates = new SqliteCandidateStore({ databasePath, encryptionKey });
    const auth = new AuthService({ databasePath });
    await auth.seedAccounts(
      [{ username: 'candidate.b304', password: 'candidate-b304-password', role: 'candidate' }],
      candidates,
    );
    const pool = new SqliteVacancyPoolStore({ databasePath });
    const now = Date.now();
    const genericVacancies = Array.from({ length: 10 }, (_, index) =>
      vacancy({
        id: `src-board:top-${index}`,
        sourceId: 'src-board',
        company: `Board ${['Amber', 'Birch', 'Cedar', 'Delta', 'Elm', 'Flint', 'Grove', 'Harbor', 'Iris', 'Juniper'][index]}`,
        url: `https://example.com/jobs/${index}?trace=${'x'.repeat(1_200)}`,
        publishedAt: new Date(now - index).toISOString(),
        requiredSkills: ['TypeScript'],
      }),
    );
    const hhVacancies = Array.from({ length: 10 }, (_, index) =>
      vacancy({
        id: `src-hh-search:hh-${index}`,
        sourceId: 'src-hh-search',
        company: `Hiring ${['Kestrel', 'Lotus', 'Maple', 'Nacre', 'Olive', 'Pearl', 'Quartz', 'River', 'Saffron', 'Topaz'][index]}`,
        url: `https://hh.ru/vacancy/${index}`,
        publishedAt: new Date(now - 86_400_000 - index).toISOString(),
        requiredSkills: [],
      }),
    );
    pool.replaceSourceSlice('src-board', genericVacancies);
    pool.replaceSourceSlice('src-hh-search', hhVacancies);

    const transport = vi.fn(async () => ({
      status: 200,
      body: [
        '<div data-qa="vacancy-description"><p>Complete role description</p></div>',
        '<div data-qa="skills-element"><span>TypeScript</span></div>',
        '<div data-qa="skills-element"><span>React</span></div>',
        '<div data-qa="skills-element"><span>PostgreSQL</span></div>',
      ].join(''),
    }));
    const engine = new MultiSourceVacancyEngine({
      pool,
      descriptionLoader: new HhVacancyDescriptionLoader({
        transport,
        sleep: async () => undefined,
        minIntervalMs: 0,
      }),
    });
    let matchReads = 0;
    const readMatchedVacancies = engine.getMatchedVacanciesAsync.bind(engine);
    engine.getMatchedVacanciesAsync = (candidate) => {
      matchReads += 1;
      return readMatchedVacancies(candidate);
    };
    const preloadTasks: Promise<unknown>[] = [];
    const preloadLogs: Array<Record<string, unknown>> = [];
    const preload = engine.preloadVacancyDescriptions.bind(engine);
    engine.preloadVacancyDescriptions = (ids, limit) => {
      const task = preload(ids, limit);
      preloadTasks.push(task);
      return task;
    };
    const config: ServerConfig = {
      host: '127.0.0.1',
      port: 3210,
      openAIKey: 'not-used',
      openRouterKey: 'not-used',
      previewToken: 'preview-token-that-is-at-least-thirty-two-characters',
      dataEncryptionKey: encryptionKey,
      databasePath,
      model: 'gpt-5.6-sol',
      staticRoot: directory,
      release: 'test',
      logLevel: 'info',
      secureCookies: false,
      allowedOrigins: ['http://localhost:3000'],
      seedAccounts: [],
    };
    const app = await buildApp({
      config,
      coachProvider: dummyProvider,
      candidateStore: candidates,
      authService: auth,
      multiSourceVacancyEngine: engine,
      serveStatic: false,
      logDestination: {
        write(line) {
          const record = JSON.parse(line) as Record<string, unknown>;
          if (record.event === 'hh-description-preload') preloadLogs.push(record);
        },
      },
    });
    resources.push({ app, auth, candidates, pool, directory });

    const { cookie, candidateId } = await signIn(app);
    candidates.saveResumeDraft(
      candidateId,
      { ...EMPTY_RESUME_DRAFT, targetRole: 'Quality Engineer' },
      [],
    );
    candidates.saveCandidateWorkspace(candidateId, {
      resumeText: 'Quality Engineer with TypeScript experience.',
      resumeSource: 'text',
      targetDirection: 'Quality Engineer',
      regions: [],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
      campaign: {
        roles: ['Quality Engineer'],
        regions: [],
        revision: 1,
        updatedAt: new Date().toISOString(),
      },
    });
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'b304-fixture',
      entries: [{ memoryId: 'skill-typescript', domain: 'skill', statement: 'TypeScript' }],
    });
    candidates.reviewMemories(candidateId, ['skill-typescript'], 'confirm');

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/matched-vacancies',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const firstPage = response.json().data as Array<{ cluster: { id: string } }>;
    expect(firstPage.length).toBeLessThan(10);
    expect(firstPage.every((item) => !item.cluster.id.includes('src-hh-search:'))).toBe(true);

    const summaries = await Promise.all(preloadTasks);

    const stored = hhVacancies.map((item) => pool.getVacancy(item.id));
    expect(transport).toHaveBeenCalledTimes(10);
    expect(stored.every((item) => item?.fullDescription === 'Complete role description')).toBe(
      true,
    );
    expect(stored.every((item) => item?.requiredSkills?.length === 3)).toBe(true);
    expect(matchReads).toBe(1);
    expect(summaries).toEqual([{ requested: 20, loaded: 10, skipped: 10, failed: 0 }]);
    expect(preloadLogs).toEqual([
      expect.objectContaining({
        event: 'hh-description-preload',
        requested: 20,
        loaded: 10,
        skipped: 10,
        failed: 0,
      }),
    ]);

    const refreshed = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/matched-vacancies',
      headers: { cookie },
    });
    await Promise.all(preloadTasks);
    expect(refreshed.statusCode).toBe(200);
    expect(matchReads).toBe(2);
  });
});
