import { roleTitleRu } from '../vacancies/roleTitleRu';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { ServerConfig } from '../config';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import type { CoachProvider } from '../providers/coachProvider';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { AuthService } from '../auth/authService';
import { MultiSourceVacancyEngine } from '../vacancies/multiSourceVacancyEngine';
import { MemoryVacancyPoolStore } from '../vacancies/memoryVacancyPoolStore';
import type { VacancyCluster } from '../domain/unifiedVacancy';

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

async function createApp(clusters: VacancyCluster[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-career-counts-'));
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

  if (clusters.length > 0) {
    poolStore.replaceSourceSlice(
      'test-source',
      clusters.map((cluster) => ({
        id: cluster.id,
        fingerprint: cluster.id,
        title: cluster.canonicalTitle,
        company: cluster.canonicalCompany,
        location: cluster.canonicalLocation,
        isRemote: cluster.isRemote,
        description: cluster.descriptionSummary,
        requiredSkills: cluster.skills,
        url: cluster.primaryUrl,
        provenance: {
          sourceId: 'test-source',
          sourceType: 'rss',
          sourceUrl: cluster.primaryUrl,
          observedAt: cluster.firstObservedAt,
        },
        publishedAt: cluster.firstObservedAt,
        status: 'active',
      })),
    );
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
    // Роль называет модель (не кандидат): её число раньше считалось по сырому пулу.
    roleNamer: {
      async nameRoles() {
        return {
          roles: [
            {
              title: 'Xray Technician',
              reason: 'семь лет в рентген-кабинете',
              evidenceRefs: ['memory:1', 'memory:1b'],
            },
          ],
          stage: 'test',
        };
      },
    },
    serveStatic: false,
  });

  resources.push({ app, auth, candidates, directory });
  return { app, candidates };
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

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const CITY: Record<string, string> = {
  a: 'Dubai, United Arab Emirates',
  b: 'Austin, TX, United States',
  c: 'Berlin, Germany',
  old: 'London, United Kingdom',
  vet: 'Paris, France',
};

function cluster(id: string, title: string, observedAt: string): VacancyCluster {
  return {
    id,
    canonicalTitle: title,
    canonicalCompany: `Clinic ${CITY[id]?.split(',')[0] ?? id}`,
    canonicalLocation: CITY[id] ?? 'Remote',
    isRemote: false,
    descriptionSummary: '',
    skills: ['X-ray'],
    primaryUrl: `https://example.com/${id}`,
    sources: [],
    firstObservedAt: observedAt,
    lastSeenAt: observedAt,
    status: 'active',
    vacanciesCount: 1,
  };
}

type Row = {
  cluster: {
    canonicalTitle: string;
    firstObservedAt: string;
    sources: Array<{ observedAt?: string }>;
  };
};

/**
 * B726: «Вакансии по роли» открывает «Подборку» с ролью и «Дата: 30 дней», и строк там
 * столько же, сколько число роли в «Карьере» («по подборке за 30 дней»).
 */
describe('B726: число роли «Карьеры» равно строкам «Подборки» по ссылке', () => {
  it('число роли = строки списка по этой роли за 30 дней', async () => {
    const { app, candidates } = await createApp([
      cluster('a', 'Xray Technician', daysAgo(1)),
      cluster('b', 'Xray Technician', daysAgo(3)),
      cluster('c', 'Senior Xray Technician', daysAgo(5)),
      cluster('old', 'Xray Technician', daysAgo(45)),
      cluster('vet', 'Veterinary Assistant', daysAgo(1)),
    ]);
    const { cookie, candidateId } = await login(app);
    candidates.saveResumeDraft(
      candidateId,
      { ...EMPTY_RESUME_DRAFT, targetRole: 'Xray Technician' },
      [],
    );
    candidates.saveCandidateWorkspace(candidateId, {
      resumeText: 'Xray Technician, seven years in radiology.',
      resumeSource: 'text',
      targetDirection: 'Xray Technician',
      regions: [],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
    });

    // Пропущенная вакансия уходит из «Подборки» — и из числа «Карьеры» тоже.
    const skip = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancy-skips',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { clusterId: 'cluster-b', reasonId: 'geo-format', origin: 'vacancy_card' },
    });
    expect(skip.statusCode).toBeLessThan(300);

    const roles = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/role-hypotheses',
      headers: { cookie },
    });
    expect(roles.statusCode).toBe(200);
    const xray = (
      roles.json().data as Array<{
        title: string;
        titleRu?: string;
        confirmation: { state: string; sampleSize?: number };
      }>
    ).find((role) => role.title === 'Xray Technician');
    expect(xray).toBeDefined();
    // B737: строка роли несёт русское название для показа; ключом остаётся title.
    expect(xray?.titleRu).toBe(roleTitleRu('Xray Technician'));

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/candidate/matched-vacancies?${new URLSearchParams({ role: 'Xray Technician' })}`,
      headers: { cookie },
    });
    expect(list.statusCode).toBe(200);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const recent = (list.json().data as Row[]).filter(
      (row) =>
        Date.parse(row.cluster.sources[0]?.observedAt ?? row.cluster.firstObservedAt) >=
        start.getTime() - 30 * DAY,
    );
    expect(recent.length).toBeGreaterThan(0);
    expect(xray!.confirmation).toMatchObject({ sampleSize: recent.length });
  });
});
