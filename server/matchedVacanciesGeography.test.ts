import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import type { ServerConfig } from './config';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import type { CoachProvider } from './providers/coachProvider';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
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

async function createApp(clusters: VacancyCluster[] = []) {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-match-geo-'));
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
        provenance: { sourceId: 'test-source', sourceType: 'rss', sourceUrl: cluster.primaryUrl, observedAt: cluster.firstObservedAt },
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


/**
 * PRB-040. «Xray Technician, MENA» открывался «Field Services Technician,
 * United States» и «Veterinary Assistant»: SQL добирал пул любыми свежими
 * записями до лимита, а регион кампании не читался нигде. Подбор считает
 * только записи, совпавшие с ролью; записи вне рынков кампании помечены и
 * стоят после остальных.
 */
describe('GET /api/v1/candidate/matched-vacancies (PRB-040)', () => {
  const at = '2026-09-17T00:00:00.000Z';
  const cluster = (id: string, title: string, location: string, isRemote = false): VacancyCluster => ({
    id,
    canonicalTitle: title,
    canonicalCompany: `Clinic ${id}`,
    canonicalLocation: location,
    isRemote,
    descriptionSummary: '',
    skills: ['X-ray'],
    primaryUrl: `https://example.com/${id}`,
    sources: [],
    firstObservedAt: at,
    lastSeenAt: at,
    status: 'active',
    vacanciesCount: 1,
  });

  it('counts only role matches and pushes records outside the campaign regions last', async () => {
    const { app, candidates } = await createApp([
      cluster('us', 'Xray Technician', 'Austin, TX, United States'),
      cluster('vet', 'Veterinary Healthcare Virtual Assistant', 'Dubai, United Arab Emirates'),
      cluster('mena', 'Xray Technician', 'Dubai, United Arab Emirates'),
      cluster('remote', 'Senior Xray Technician', 'Remote', true),
    ]);
    const { cookie, candidateId } = await login(app);
    candidates.saveResumeDraft(candidateId, { ...EMPTY_RESUME_DRAFT, targetRole: 'Xray Technician' }, []);
    candidates.saveCandidateWorkspace(candidateId, {
      resumeText: 'Xray Technician, seven years in radiology.',
      resumeSource: 'text',
      targetDirection: 'Xray Technician',
      regions: ['mena'],
      currentSituation: '',
      constraints: '',
      urgency: 'active',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/matched-vacancies',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().data as Array<{
      cluster: { id: string };
      explanation: { outsideGeography?: boolean };
    }>;
    // Внутри яруса порядок решает подбор; здесь важно, что запись из США —
    // последняя и подписана, а «ветеринарный ассистент» не прошёл роль.
    expect(items.slice(0, 2).map((item) => item.cluster.id).sort()).toEqual(['cluster-mena', 'cluster-remote']);
    expect(items[2].cluster.id).toBe('cluster-us');
    expect(items.map((item) => item.explanation.outsideGeography ?? false)).toEqual([false, false, true]);
    expect(response.json().meta.total).toBe(3);
  });
});
