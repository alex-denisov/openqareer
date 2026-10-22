/** B510: disposable loopback-only demo of block C «Вакансии»; synthetic data, no external calls. */
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../server/app';
import type { SessionAuth } from '../server/auth/authService';
import type { ServerConfig } from '../server/config';
import { SqliteCandidateStore } from '../server/data/sqliteCandidateStore';
import { SqliteRecruiterContactsRepository } from '../server/data/sqliteRecruiterContactsRepository';
import { currentVacancyFitProfileValidator } from '../server/domain/vacancyFitProfileStamp';
import { VacancyMechanicsRuntime } from '../server/domain/vacancyMechanicsRuntime';
import type { RoleNamer } from '../server/providers/roleNamer';
import { sendError } from '../server/routes/helpers';
import { SqliteVacancyPoolStore } from '../server/vacancies/sqliteVacancyPoolStore';
import { runBlockCFitWorker, runBlockCMaintenancePasses } from './fixtures/block-c-maintenance';
import { MultiSourceVacancyEngine } from '../server/vacancies/multiSourceVacancyEngine';
import { DEFAULT_VACANCY_SOURCES } from '../server/vacancies/defaultVacancySources';
import { createCandidateStoreRouter } from './fixtures/block-a-demo-scenarios';
import { buildBlockCCatalog } from './fixtures/block-c-catalog';
import {
  BLOCK_C_SLOW_MS,
  BlockCDemoScenarioController,
  parseBlockCDemoScenarioCommand,
  type BlockCProfileKey,
} from './fixtures/block-c-demo-scenarios';
import {
  BLOCK_C_EMPTY_ROLES,
  BLOCK_C_FIT_CLUSTERS,
  BLOCK_C_FEW_DATA_ROLES,
  BLOCK_C_MAIN_ROLES,
  closedBlockCVacancies,
  savedBlockCVacancies,
  seedBlockCCandidate,
  seedBlockCRecruiter,
  seedBlockCSaved,
  seedBlockCThroughRoutes,
} from './fixtures/block-c-seed';

const port = Number(process.env.BLOCK_C_DEMO_PORT ?? '4556');
const origin = `http://127.0.0.1:${port}`;
// A temp file, not ':memory:': the fit worker below opens the same database.
const directory = mkdtempSync(path.join(tmpdir(), 'openqareer-block-c-'));
const databasePath = path.join(directory, 'demo.db');
const config: ServerConfig = {
  host: '127.0.0.1',
  port,
  previewToken: randomBytes(32).toString('hex'),
  dataEncryptionKey: randomBytes(32),
  databasePath,
  model: 'fixture-disabled',
  staticRoot: path.resolve('dist'),
  release: 'block-c-local-demo',
  logLevel: 'error',
  secureCookies: false,
  // The desktop shell sends the production origin; the stand still listens on loopback only.
  allowedOrigins: [origin, 'tauri://localhost', 'http://tauri.localhost', 'https://openqareer.com'],
  seedAccounts: [],
};
const now = new Date();

// The SQLite pool, as on production: the maintenance passes below read its tables.
const pool = new SqliteVacancyPoolStore({ databasePath });
const catalog = buildBlockCCatalog(now);
for (const [sourceId, rows] of catalog) pool.replaceSourceSlice(sourceId, rows);
const rows = [...catalog.values()].flat();
const saved = savedBlockCVacancies(rows);
const closed = closedBlockCVacancies(saved);
const sourceIds = new Set(catalog.keys());
const engine = new MultiSourceVacancyEngine({
  pool,
  recluster: { mode: 'sync' },
  // Registered sources only: nothing here has a fetcher, so no sync can leave the host.
  sources: DEFAULT_VACANCY_SOURCES.filter((source) => sourceIds.has(source.id)),
});

const candidateStore = new SqliteCandidateStore({
  databasePath,
  encryptionKey: config.dataEncryptionKey,
});
const recruiterContactsRepo = new SqliteRecruiterContactsRepository({ databasePath });
const PROFILE_SEEDS: Record<
  BlockCProfileKey,
  { roles: readonly string[]; saved: boolean; contacts: boolean }
> = {
  main: { roles: BLOCK_C_MAIN_ROLES, saved: true, contacts: true },
  empty: { roles: BLOCK_C_EMPTY_ROLES, saved: false, contacts: false },
  noSaved: { roles: BLOCK_C_MAIN_ROLES, saved: false, contacts: true },
  fewData: { roles: BLOCK_C_FEW_DATA_ROLES, saved: false, contacts: true },
  noContacts: { roles: BLOCK_C_MAIN_ROLES, saved: true, contacts: false },
};
const profiles = Object.fromEntries(
  Object.entries(PROFILE_SEEDS).map(([key, seed]) => {
    const candidate = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    seedBlockCCandidate(candidateStore, candidate.id, seed, now);
    if (seed.saved) seedBlockCSaved(candidateStore, candidate.id, saved, now);
    if (seed.contacts) seedBlockCRecruiter(recruiterContactsRepo, candidate.id, now);
    return [key, { candidate, seed }];
  }),
) as Record<
  BlockCProfileKey,
  {
    candidate: ReturnType<SqliteCandidateStore['createCandidate']>;
    seed: (typeof PROFILE_SEEDS)[BlockCProfileKey];
  }
>;
// Closed on the platform after being saved: the pool buries them with the date of closing.
pool.markExpired(
  closed.map((row) => row.id),
  new Date(now.getTime() - 2 * 24 * 3_600_000).toISOString(),
);

const scenarios = new BlockCDemoScenarioController(profiles);
const principalFor = (candidate: (typeof profiles)['main']['candidate']) => ({
  id: 'block-c-local',
  userId: 'block-c-local',
  username: 'block-c.local',
  displayName: 'Локальная проверка блока C',
  email: 'block-c@example.test',
  role: 'candidate' as const,
  isTest: true,
  emailVerified: true,
  candidate,
});
const authService: SessionAuth = {
  authenticate: () => principalFor(scenarios.activeProfile.candidate),
  getAccount: () => ({
    username: 'block-c.local',
    email: 'block-c@example.test',
    displayName: 'Локальная проверка блока C',
    profile: { headline: null, location: null, workMode: null, updatedAt: null },
    sessions: [],
  }),
  register: async () => {
    throw new Error('Registration is disabled in the local demo.');
  },
  // The desktop shell keeps its own token and shows the sign-in screen without one:
  // any credentials open the active synthetic profile, as every other request does.
  login: async () => ({
    principal: principalFor(scenarios.activeProfile.candidate),
    sessionToken: 'block-local-demo-session',
  }),
  isUsernameTaken: () => false,
  logout() {},
};

// Block B «Карьера»: roles are named by a model; the demo names the seeded target roles instead.
const roleNamer: RoleNamer = {
  nameRoles: async (facts) => ({
    stage: 'block-demo-fixture',
    roles: scenarios.activeProfile.seed.roles.map((title) => ({
      title,
      reason: 'Синтетическая роль демо-стенда: совпадает с целевой ролью профиля.',
      evidenceRefs: facts.slice(0, 2).map((fact) => fact.ref),
    })),
  }),
};

const disabled = async () => {
  throw new Error('External sources and providers are disabled in the local demo.');
};
const app = await buildApp({
  config,
  candidateStore: createCandidateStoreRouter(candidateStore, new Map()),
  multiSourceVacancyEngine: engine,
  recruiterContactsRepo,
  roleNamer,
  authService,
  searchVacancies: disabled,
  searchRemotive: disabled,
  importProfile: disabled,
  coachProvider: { createTurn: disabled },
});

app.addHook('onRequest', async (request, reply) => {
  if (request.url === '/') return reply.redirect('/app');
  request.headers.authorization ??= `Bearer ${scenarios.activeProfile.candidate.accessToken}`;
  const pathname = request.url.split('?')[0];
  if (request.method !== 'GET' || pathname !== '/api/v1/candidate/matched-vacancies') return;
  const disposition = scenarios.poolDisposition();
  if (disposition === 'delay') await new Promise((resolve) => setTimeout(resolve, BLOCK_C_SLOW_MS));
  if (disposition === 'fail') {
    return sendError(
      reply,
      request,
      503,
      'block_c_demo_pool_unavailable',
      'В локальном сценарии чтение подборки временно недоступно.',
      true,
    );
  }
});
app.get('/__block-c/scenario', async () => ({ synthetic: true, ...scenarios.state }));
app.post('/__block-c/scenario', async (request, reply) => {
  const parsed = parseBlockCDemoScenarioCommand(request.body);
  if (!parsed.ok) return sendError(reply, request, 400, parsed.code, parsed.message, false);
  scenarios.select(parsed.scenario);
  return { synthetic: true, ...scenarios.state };
});

for (const { candidate, seed } of Object.values(profiles)) {
  await seedBlockCThroughRoutes(app, candidate.id, candidate.accessToken, origin, {
    contacts: seed.contacts,
    wants: seed.roles !== BLOCK_C_EMPTY_ROLES,
  });
}

const passes = runBlockCMaintenancePasses(databasePath, engine, pool, now);
// Mechanics worker for the mockup's top rows; requirements by rules, fit by the literal client.
const mechanics = new VacancyMechanicsRuntime(
  databasePath,
  config.dataEncryptionKey,
  currentVacancyFitProfileValidator(candidateStore),
);
await runBlockCFitWorker(
  app,
  mechanics,
  profiles.main.candidate.accessToken,
  origin,
  BLOCK_C_FIT_CLUSTERS,
);

await app.listen({ host: config.host, port: config.port });
console.log(
  `Block C local demo: ${origin}/app; ${rows.length} synthetic rows; ` +
    `${passes.semanticKeys} title keys, ${passes.salaryKeys} salary estimates.`,
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
    mechanics.close();
    candidateStore.close();
    rmSync(directory, { recursive: true, force: true });
    process.exit(0);
  });
