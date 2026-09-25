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
import type { CoverLetterWriter } from './providers/coverLetterWriter';
import { normalizeJsonSource } from './vacancies/jsonSourceAdapters';

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

async function createApp(
  clusters: VacancyCluster[] = [],
  options: { persisted?: boolean; coverLetterWriter?: CoverLetterWriter } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-pitch-routes-'));
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
    ...(options.coverLetterWriter ? { coverLetterWriter: options.coverLetterWriter } : {}),
  });

  resources.push({ app, auth, candidates, directory });
  return { app, candidates, multiSourceEngine, poolStore };
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

describe('POST /api/v1/candidate/vacancies/:id/pitch', () => {
  const sampleCluster: VacancyCluster = {
    id: 'cluster-99',
    canonicalTitle: 'Senior Platform Engineer',
    canonicalCompany: 'CloudScale Inc',
    canonicalLocation: 'Remote',
    isRemote: true,
    descriptionSummary: 'Разработка высоконагруженной платформы на Node.js и Kubernetes',
    skills: ['Node.js', 'TypeScript', 'Kubernetes', 'PostgreSQL'],
    primaryUrl: 'https://example.com/vacancies/99',
    sources: [],
    firstObservedAt: '2026-09-17T00:00:00.000Z',
    lastSeenAt: '2026-09-17T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  };

  it('rejects unauthenticated requests with 401 or redirection', async () => {
    const { app } = await createApp([sampleCluster]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects unsafe origin with 403', async () => {
    const { app } = await createApp([sampleCluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://malicious.site' },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 when vacancy is not found and no override provided', async () => {
    const { app } = await createApp([]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/non-existent/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });

  // Владелец 2026-09-20: «Подготовить отклик» в .app — ошибка, а прод после
  // нажатия перестаёт отвечать. Маршрут искал кластер через
  // `getActiveClusters().find(...)`, то есть поднимал все 120K кластеров.
  it('reads one persisted cluster instead of hydrating the whole pool (PRB-041)', async () => {
    const { app } = await createApp([sampleCluster], { persisted: true });
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.emailPitch.subject).toContain('Senior Platform Engineer');
  });

  // Прод 2026-09-21: id кластера — это ключ источника с полным адресом
  // (`cluster-src-himalayas-api:https://himalayas.app/companies/…/jobs/…`),
  // 130+ символов; Fastify по умолчанию режет параметр на 100 и отвечает 414
  // без текста сервера — кандидат видел «Сервис не завершил действие».
  it('accepts a long source-keyed cluster id in the path (PRB-041)', async () => {
    const longId =
      'cluster-src-himalayas-api:https://himalayas.app/companies/bright-vision-technologies/jobs/solutions-architect-and-platform-lead';
    const { app } = await createApp([{ ...sampleCluster, id: longId }], { persisted: true });
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/vacancies/${encodeURIComponent(longId)}/pitch`,
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.vacancyId).toBe(longId);
  });

  it('generates pitch with 3 formats using confirmed candidate facts', async () => {
    const { app, candidates } = await createApp([sampleCluster]);
    const { cookie, candidateId } = await login(app);

    // Add confirmed facts to candidate
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [
        {
          memoryId: 'mem-101',
          domain: 'outcome',
          statement: 'Увеличил пропускную способность API в 4 раза, снизил p99 latency до 45мс',
        },
        {
          memoryId: 'mem-102',
          domain: 'skill',
          statement: 'Владею TypeScript, Node.js, PostgreSQL, Redis',
        },
      ],
    });
    candidates.reviewMemories(candidateId, ['mem-101', 'mem-102'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { tone: 'technical' },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.data).toMatchObject({
      vacancyId: 'cluster-99',
      emailPitch: {
        subject: expect.stringContaining('Senior Platform Engineer'),
        body: expect.stringContaining('CloudScale Inc'),
      },
      linkedInNote: expect.any(String),
      atsCoverLetter: expect.stringContaining('Senior Platform Engineer'),
      usedEvidenceIds: expect.arrayContaining(['mem-101']),
    });

    expect(json.data.linkedInNote.length).toBeLessThanOrEqual(300);
  });

  // B266, пункт 7: письмо пишет модель, шаблон — запас.
  it('uses the model letter and reports its stage when the writer succeeds', async () => {
    const writer: CoverLetterWriter = {
      writeCoverLetter: async () => ({
        body: 'Здравствуйте! Пишу по вакансии от модели.',
        stage: 'openai:gpt-test',
      }),
    };
    const { app, candidates } = await createApp([sampleCluster], { coverLetterWriter: writer });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [
        { memoryId: 'mem-201', domain: 'skill', statement: 'Владею TypeScript, Node.js' },
      ],
    });
    candidates.reviewMemories(candidateId, ['mem-201'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.bodySource).toBe('model');
    expect(data.stage).toBe('openai:gpt-test');
    expect(data.atsCoverLetter).toBe('Здравствуйте! Пишу по вакансии от модели.');
  });

  it('falls back to the template letter when the writer fails', async () => {
    const writer: CoverLetterWriter = {
      writeCoverLetter: async () => ({ failure: { stage: 'openai:gpt-test', kind: 'timeout' } }),
    };
    const { app, candidates } = await createApp([sampleCluster], { coverLetterWriter: writer });
    const { cookie, candidateId } = await login(app);
    candidates.importResumeEvidence(candidateId, {
      sourceLabel: 'test-import',
      entries: [
        { memoryId: 'mem-202', domain: 'skill', statement: 'Владею TypeScript, Node.js' },
      ],
    });
    candidates.reviewMemories(candidateId, ['mem-202'], 'confirm');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.bodySource).toBe('template');
    expect(data.stage).toBeUndefined();
    expect(data.atsCoverLetter).toContain('Senior Platform Engineer');
  });

  // B251, S2, architecture.md §4: an optional `applicationId` saves the
  // letter to `candidate_documents` and links it to the card in one call.
  it('saves and links the letter when applicationId is provided', async () => {
    const { app, candidates } = await createApp([sampleCluster]);
    const { cookie, candidateId } = await login(app);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/applications',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { clusterId: 'cluster-99', stage: 'saved' },
    });
    const applicationId = created.json().data.id;

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { applicationId },
    });
    expect(response.statusCode).toBe(200);

    const documents = candidates.getSnapshot(candidateId)?.documents ?? [];
    const letter = documents.find(
      (doc) => doc.kind === 'cover_letter' && doc.source === 'generated',
    );
    expect(letter).toBeDefined();

    const application = candidates
      .listApplications(candidateId)
      .find((a) => a.id === applicationId);
    expect(application?.materials).toMatchObject({ coverLetter: true });
  });

  it('returns 404 when applicationId belongs to a different candidate', async () => {
    const { app } = await createApp([sampleCluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/vacancies/cluster-99/pitch',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { applicationId: 'not-a-real-application' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/v1/vacancies/:id/enrich-contacts', () => {
  const cluster: VacancyCluster = {
    id: 'cluster-77',
    canonicalTitle: 'Product Manager',
    canonicalCompany: 'Acme',
    canonicalLocation: 'Berlin',
    isRemote: false,
    descriptionSummary: 'Контакты: рекрутер Анна Семенова, a.semenova@acme-corp.com',
    skills: [],
    primaryUrl: 'https://careers.acme-corp.com/jobs/77',
    sources: [],
    firstObservedAt: '2026-09-17T00:00:00.000Z',
    lastSeenAt: '2026-09-17T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  };

  // Та же причина, что у отклика: «Найти прямые контакты» поднимало весь пул
  // кластеров ради одной записи (владелец 2026-09-20, PRB-041).
  it('reads one persisted cluster instead of hydrating the whole pool (PRB-041)', async () => {
    const { app } = await createApp([cluster], { persisted: true });
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/vacancies/cluster-77/enrich-contacts',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().data.job).toMatchObject({
      candidateId: expect.any(String),
      vacancyId: 'cluster-77',
      status: 'queued',
    });
  });
});

describe('GET /api/v1/candidate/vacancies/:id/detail (B266)', () => {
  const cluster: VacancyCluster = {
    id: 'cluster-77',
    canonicalTitle: 'VP of Technology',
    canonicalCompany: 'Arctic Wolf',
    canonicalLocation: 'United States',
    isRemote: true,
    descriptionSummary: 'Short summary only',
    skills: ['Cloud', 'P&L'],
    primaryUrl: 'https://example.com/vacancies/77',
    sources: [],
    firstObservedAt: '2026-09-17T00:00:00.000Z',
    lastSeenAt: '2026-09-17T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
  };

  it('requires a signed-in candidate', async () => {
    const { app } = await createApp([cluster]);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-77/detail',
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns the full pooled Jobicy description, not its excerpt or the cluster summary', async () => {
    const jobicyCluster = { ...cluster, id: 'cluster-src-jobicy:151630' };
    const { app, poolStore } = await createApp([jobicyCluster]);
    const excerpt = 'Short source excerpt ending early…';
    const fullText = 'Full posting: lead 250 engineers across three regions. '.repeat(20);
    const vacancies = normalizeJsonSource(
      'src-jobicy',
      {
        jobs: [
          {
            id: 151630,
            url: 'https://jobicy.com/jobs/151630-vp-technology',
            jobTitle: 'VP of Technology',
            companyName: 'Arctic Wolf',
            jobExcerpt: excerpt,
            jobDescription: fullText,
            pubDate: '2026-09-17 00:00:00',
          },
        ],
      },
      { observedAt: '2026-09-17T00:00:00.000Z' },
    );
    poolStore.replaceSourceSlice('src-jobicy', vacancies);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-src-jobicy%3A151630/detail',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: 'cluster-src-jobicy:151630',
      skills: ['Cloud', 'P&L'],
      truncated: false,
    });
    expect(response.json().data.description).toBe(fullText.trim());
  });

  it('marks the cluster summary as truncated when the source record is unavailable', async () => {
    const { app } = await createApp([cluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-77/detail',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      description: 'Short summary only',
      truncated: true,
    });
  });

  it('answers 404 for an unknown vacancy', async () => {
    const { app } = await createApp([cluster]);
    const { cookie } = await login(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/vacancies/cluster-nope/detail',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
