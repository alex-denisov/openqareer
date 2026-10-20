/** Disposable loopback-only native QA; no real accounts or external model calls. */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  CareerCommandPlanner,
  careerCommandExecutionTargetSchema,
} from '../server/orchestration/careerCommandPlanner';
import path from 'node:path';
import { buildApp } from '../server/app';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import { SqliteCandidateReputationRepository } from '../server/data/sqliteCandidateReputationRepository';
import { historicalAudit } from './fixtures/block-a-footprint-fixture';
import { seedBlockAToday, seedBlockATodayChanges } from './fixtures/block-a-today-seed';
import { mockupResumeDraft, seedMockupToday } from './fixtures/mockup-today-seed';
import { seedLandingShots } from './fixtures/landing-shots-seed';
import { SqliteCandidateDraftRepository } from '../server/candidate/sqliteCandidateDraftRepository';
import type { SessionAuth } from '../server/auth/authService';
import type { ServerConfig } from '../server/config';
import { buildResumeStudioProjection } from '../server/domain/resumeStudio';
import {
  syntheticResumeDraft,
  syntheticResumeMemory,
  createCommands,
} from './fixtures/block-a-visual-fixture';
import { seedDemoResumeVersions } from './fixtures/block-a-native-version-seed';

import { sendError } from '../server/routes/helpers';
import {
  BlockADemoScenarioController,
  createCandidateStoreRouter,
  createEmptyDemoWorkspace,
  parseBlockADemoScenarioCommand,
} from './fixtures/block-a-demo-scenarios';
const config: ServerConfig = {
  host: '127.0.0.1',
  port: Number(process.env.BLOCK_A_DEMO_PORT ?? '4554'),
  previewToken: randomBytes(32).toString('hex'),
  dataEncryptionKey: randomBytes(32),
  databasePath: ':memory:',
  model: 'fixture-disabled',
  staticRoot: path.resolve('dist'),
  release: 'block-a-local-demo',
  logLevel: 'error',
  secureCookies: false,
  allowedOrigins: [
    `http://127.0.0.1:${process.env.BLOCK_A_DEMO_PORT ?? '4554'}`,
    ...(process.env.BLOCK_A_DEMO_UI_ORIGIN ? [process.env.BLOCK_A_DEMO_UI_ORIGIN] : []),
    'tauri://localhost',
    'http://tauri.localhost',
    'https://openqareer.com',
  ],
  seedAccounts: [],
};
const candidateStore = new SqliteCandidateStore({
  databasePath: ':memory:',
  encryptionKey: config.dataEncryptionKey,
});
const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
const todaySeed = seedBlockAToday(candidateStore, candidate.id, config.applicationArchiveStaleDays);
const candidateDraftRepository = new SqliteCandidateDraftRepository({ databasePath: ':memory:' });
seedMockupToday(candidateStore, candidateDraftRepository, candidate.id);
if (process.env.LANDING_SHOTS === '1') seedLandingShots(candidateStore, candidate.id);
// Two imports, as in the approved Profile mockup: LinkedIn and hh.ru each own their facts,
// so the source chips and provenance read real import labels, not a synthetic one.
const fromHh = (fact: (typeof syntheticResumeMemory)[number]) => /marketing/u.test(fact.id);
for (const [platform, sourceLabel, facts] of [
  [
    'linkedin',
    'Импорт: профиль LinkedIn (синтетический набор блока A)',
    syntheticResumeMemory.filter((f) => !fromHh(f)),
  ],
  [
    'hh',
    'Импорт: резюме hh.ru (синтетический набор блока A)',
    syntheticResumeMemory.filter(fromHh),
  ],
] as const) {
  candidateStore.importResumeEvidence(candidate.id, {
    sourceLabel,
    platform,
    entries: facts.map((fact) => ({
      memoryId: fact.id,
      domain: fact.domain,
      statement: fact.statement,
    })),
  });
}
for (const fact of syntheticResumeMemory) {
  if (fact.status === 'confirmed')
    candidateStore.changeMemory(candidate.id, fact.id, { action: 'confirm' });
}
// B541, макет 2: «LinkedIn: читаем разделы, 3 из 7» — the walk the profile shows after a reload.
candidateStore.saveImportWalk(candidate.id, {
  platform: 'linkedin',
  state: 'running',
  updatedAt: new Date().toISOString(),
  sections: [
    { key: 'experience', status: 'read' },
    { key: 'education', status: 'read' },
    { key: 'skills', status: 'read' },
    { key: 'languages', status: 'pending' },
    { key: 'projects', status: 'pending' },
    { key: 'courses', status: 'pending' },
    { key: 'contactInfo', status: 'pending' },
  ],
});
const memory = candidateStore.getSnapshot(candidate.id)?.memory ?? [];
const resumeDraft = mockupResumeDraft(syntheticResumeDraft);
const projection = buildResumeStudioProjection({ ...resumeDraft, evidence: memory });
candidateStore.saveResumeDraft(candidate.id, resumeDraft, projection.evidenceSnapshot);
candidateStore.saveCandidateWorkspace(candidate.id, {
  careerGoal: 'find-job',
  resumeText: '',
  resumeSource: 'text',
  resumeImported: true,
  targetDirection: 'CTO',
  regions: [],
  currentSituation: 'Синтетический профиль для локальной проверки блока A.',
  constraints: '',
  urgency: 'active',
});
seedBlockATodayChanges(candidateStore, candidate.id, todaySeed.applicationIds.followUp);
const planner = new CareerCommandPlanner({ createId: randomUUID });
const availableEvidenceRefs = new Set(memory.map((fact) => `memory:${fact.id}`));
for (const fixture of createCommands()) {
  const command = planner.materialize({
    principal: { candidateId: candidate.id },
    proposal: fixture.proposal,
    availableEvidenceRefs,
    strategyDecisionId: randomUUID(),
    modelInvocationIds: [],
    idempotencyKey: randomUUID(),
    approval: null,
    executionTarget: careerCommandExecutionTargetSchema.parse(fixture.executionTarget),
  });
  candidateStore.saveCareerCommand(command);
}
const candidateReputationRepo = new SqliteCandidateReputationRepository({
  databasePath: ':memory:',
  encryptionKey: config.dataEncryptionKey,
});
candidateReputationRepo.saveFootprintAudit(historicalAudit(candidate.id));
const principal = {
  id: 'block-a-local',
  // Consent reads key on the user id; without it «Цифровой след» answered 500 on the demo.
  userId: 'block-a-local',
  username: 'block-a.local',
  displayName: 'Локальная проверка блока A',
  email: 'block-a@example.test',
  role: 'candidate' as const,
  isTest: true,
  emailVerified: true,
  candidate,
};
const authService: SessionAuth = {
  authenticate: () => principal,
  getAccount: () => ({
    username: principal.username,
    email: principal.email,
    displayName: principal.displayName,
    profile: { headline: null, location: null, workMode: null, updatedAt: null },
    sessions: [],
  }),
  register: async () => {
    throw new Error('Registration is disabled in the local demo.');
  },
  login: async (username, password) =>
    username === 'block-a.local' && password === 'local-demo-only'
      ? { principal, sessionToken: candidate.accessToken }
      : null,
  isUsernameTaken: () => false,
  logout() {},
};
const emptyCandidateStore = new SqliteCandidateStore({
  databasePath: ':memory:',
  encryptionKey: randomBytes(32),
});
const emptyCandidate = emptyCandidateStore.createCandidate({
  dataClass: 'synthetic',
  locale: 'ru-RU',
});
emptyCandidateStore.saveCandidateWorkspace(emptyCandidate.id, createEmptyDemoWorkspace());
const scenarios = new BlockADemoScenarioController({
  normal: { candidate, store: candidateStore },
  empty: { candidate: emptyCandidate, store: emptyCandidateStore },
});
const routedCandidateStore = createCandidateStoreRouter(
  candidateStore,
  new Map([
    [candidate.id, candidateStore],
    [emptyCandidate.id, emptyCandidateStore],
  ]),
);
const app = await buildApp({
  config,
  candidateStore: routedCandidateStore,
  candidateDraftRepository,
  candidateReputationRepo,
  authService,
  searchVacancies: async () => {
    throw new Error('External sources are disabled in the local demo.');
  },
  searchRemotive: async () => {
    throw new Error('External sources are disabled in the local demo.');
  },
  importProfile: async () => {
    throw new Error('External imports are disabled in the local demo.');
  },
  coachProvider: {
    createTurn: async () => {
      throw new Error('External providers are disabled in the local demo.');
    },
  },
});
app.addHook('onRequest', async (request, reply) => {
  if (request.url === '/') return reply.redirect('/app');
  request.headers.authorization = `Bearer ${scenarios.activeCandidate.candidate.accessToken}`;

  const pathname = request.url.split('?')[0];
  if (request.method === 'POST' && pathname === '/api/v1/candidate/footprint/start') {
    return sendError(
      reply,
      request,
      503,
      'block_a_demo_footprint_providers_disabled',
      'Локальный демо-сценарий не выполняет внешние проверки цифрового следа.',
      false,
    );
  }
  if (request.method === 'PUT' && pathname === '/api/v1/candidate/resume') {
    if (scenarios.beforeResumePut() === 'unavailable') {
      return sendError(
        reply,
        request,
        503,
        'block_a_demo_resume_save_unavailable',
        'В локальном сценарии сохранение резюме временно недоступно.',
        true,
      );
    }
  }
  if (request.method === 'GET' && pathname === '/api/v1/candidate/resume') {
    const disposition = await scenarios.beforeResumeGet();
    if (disposition === 'unavailable') {
      return sendError(
        reply,
        request,
        503,
        'block_a_demo_resume_unavailable',
        'В локальном сценарии чтение резюме временно недоступно.',
        true,
      );
    }
  }
});
app.addHook('onResponse', async (request, reply) => {
  if (request.url.startsWith('/api/'))
    console.log('demo-api', request.method, request.url.split('?')[0], reply.statusCode);
});
app.get('/__block-a/state', async () => ({
  synthetic: true,
  providerCallsEnabled: false,
  footprintProviderCallsBlocked: true,
  resumeSaved: Boolean(candidateStore.getSnapshot(candidate.id).resume),
  scenario: scenarios.state,
}));
app.get('/__block-a/scenario', async () => scenarios.state);
app.post('/__block-a/scenario', async (request, reply) => {
  const parsed = parseBlockADemoScenarioCommand(request.body);
  if (!parsed.ok) {
    return sendError(reply, request, 400, parsed.code, parsed.message, false);
  }
  if (parsed.command.profile) scenarios.selectProfile(parsed.command.profile);
  if (parsed.command.resumeMode) scenarios.setResumeMode(parsed.command.resumeMode);
  if (parsed.command.resumeSaveMode) scenarios.setResumeSaveMode(parsed.command.resumeSaveMode);
  return { synthetic: true, scenario: scenarios.state };
});
await seedDemoResumeVersions(app, `http://${config.host}:${config.port}`);
await app.listen({ host: config.host, port: config.port });
console.log(
  `Block A local demo: http://127.0.0.1:${config.port}/app; disposable synthetic candidate.`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
    candidateStore.close();
    emptyCandidateStore.close();
    process.exit(0);
  });
