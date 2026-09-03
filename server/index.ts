import { buildApp } from './app';
import { readServerConfig } from './config';
import { buildCoachProvider } from './providers/coachProviderFactory';
import { buildResumeStructurer } from './providers/resumeStructurer';
import { buildRoleNamer } from './providers/roleNamer';
import { PrivacyAwareCoachProvider } from './providers/privacyAwareCoachProvider';
import { CareerOrchestrator } from './orchestration/careerOrchestrator';
import { CoachProviderRoleAgent } from './orchestration/coachProviderRoleAgent';
import { ResilientCoachProvider } from './providers/resilientCoachProvider';
import {
  namedQueueDepth,
  selectProviderQueue,
  type ProviderQueueEntry,
} from './providers/providerQueue';
import { SqliteCandidateStore } from './data/sqliteCandidateStore';
import { AuthService } from './auth/authService';
import { buildPasswordResetNotifier } from './auth/passwordResetEmail';
import { searchHhVacancies } from './connectors/hhVacancySearch';
import { searchRemotiveVacancies } from './connectors/remotiveVacancySearch';
import { VacancyIntelligenceService } from './vacancies/vacancyIntelligenceService';
import { CareerCommandConnectorRouter } from './connectors/careerCommandConnectorRouter';
import { HhConnector } from './connectors/hh/hhConnector';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import { buildMultiSourceFetcher } from './vacancies/multiSourceFetcher';
import { SqliteVacancyPoolStore } from './vacancies/sqliteVacancyPoolStore';

const config = readServerConfig(process.env);
const candidateStore = new SqliteCandidateStore({
  databasePath: config.databasePath,
  encryptionKey: config.dataEncryptionKey,
});
const authService = new AuthService({
  databasePath: config.databasePath,
  ...(config.accountEmail
    ? {
        onPasswordReset: buildPasswordResetNotifier({
          apiKey: config.accountEmail.apiKey,
          from: config.accountEmail.from,
          publicBaseUrl: config.accountEmail.publicBaseUrl,
        }),
      }
    : {}),
});
await authService.seedAccounts(config.seedAccounts, candidateStore);
const personalProviderId = config.personalProvider ?? 'openai';
const syntheticProviderId = config.syntheticProvider ?? 'openrouter';
// Обоим классам данных — одна и та же очередь моделей: провайдер, который
// не ответил, уступает следующему, а не роняет ход (решение владельца
// 2026-09-02). Персональный класс отличается только своим списком.
const buildQueue = (
  head: ProviderQueueEntry,
  fallbacks: readonly ProviderQueueEntry[] | undefined,
) =>
  selectProviderQueue({
    head,
    fallbacks,
    credentials: config.providerCredentials ?? {},
  }).map((route) => ({
    id: route.provider,
    model: route.model,
    provider: buildCoachProvider({
      ...route,
      folderId: config.yandexFolderId,
      cloudflareGateway: config.cloudflareGateway,
    }),
  }));

const personalHead = { provider: personalProviderId, model: config.model };
const syntheticHead = {
  provider: syntheticProviderId,
  model: config.syntheticModel,
};
const personalDataProvider = new ResilientCoachProvider({
  routes: buildQueue(personalHead, config.personalFallbacks),
  maxAttempts: namedQueueDepth({
    head: personalHead,
    fallbacks: config.personalFallbacks,
  }),
});
const syntheticDataProvider = new ResilientCoachProvider({
  routes: buildQueue(syntheticHead, config.syntheticFallbacks),
  maxAttempts: namedQueueDepth({
    head: syntheticHead,
    fallbacks: config.syntheticFallbacks,
  }),
});
const routedProvider = new PrivacyAwareCoachProvider({
  personalDataProvider,
  syntheticDataProvider,
});
const coachProvider = new CareerOrchestrator({
  roleAgent: new CoachProviderRoleAgent({ provider: routedProvider }),
});
const vacancyIntelligenceService = new VacancyIntelligenceService({
  store: candidateStore,
  connectors: {
    hh: searchHhVacancies,
    remotive: searchRemotiveVacancies,
  },
  maxBatchSize: 5,
});
const careerCommandExecutor = new CareerCommandConnectorRouter({
  hh: new HhConnector(),
});
// Built here rather than inside `buildApp`, so the process that owns the
// timers also owns the pool they fill (B164).
const vacancyPoolStore = new SqliteVacancyPoolStore({
  databasePath: config.databasePath,
});
const multiSourceEngine = new MultiSourceVacancyEngine({
  fetcher: buildMultiSourceFetcher(searchHhVacancies, searchRemotiveVacancies),
  pool: vacancyPoolStore,
});
// The pool the previous process filled is served immediately, so a restart no
// longer empties «Возможности» until the scheduler's next run (B164).
const restoredPool = multiSourceEngine.restore();
const app = await buildApp({
  config,
  coachProvider,
  candidateStore,
  authService,
  vacancyIntelligenceService,
  multiSourceVacancyEngine: multiSourceEngine,
  careerCommandExecutor,
  resumeStructurer: buildResumeStructurer({
    personalProvider: personalProviderId,
    model: config.model,
    providerCredentials: config.providerCredentials,
  }),
  roleNamer: buildRoleNamer({
    personalProvider: personalProviderId,
    model: config.model,
    // Очередь та же, что у хода коуча: с потолком ступени в тридцать секунд
    // одинокая бесплатная голова оставляла панель пустой (B180, 2026-09-03).
    fallbacks: config.personalFallbacks,
    providerCredentials: config.providerCredentials,
    // Голова называния — Gemini, и без тоннеля она не строится (решение
    // владельца 2026-09-03).
    cloudflareGateway: config.cloudflareGateway,
  }),
  serveStatic: process.env.NODE_ENV === 'production',
});

let vacancyRefreshTimer: NodeJS.Timeout | undefined;
let multiSourceSyncTimer: NodeJS.Timeout | undefined;
let documentRetentionTimer: NodeJS.Timeout | undefined;

function runVacancyRefresh(): void {
  void vacancyIntelligenceService
    .runDue()
    .then((result) => {
      if (result.claimed > 0) {
        app.log.info(result, 'vacancy-refresh-completed');
      }
    })
    .catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'vacancy-refresh-failed',
      );
    });
}

/**
 * Fills the vacancy pool without anyone pressing a button. Until B164 the only
 * caller of a sync was the admin route, so a fresh process — and therefore
 * every deploy — served an empty «Возможности» (B161 review §2).
 */
function runMultiSourceSync(): void {
  void multiSourceEngine
    .syncDue()
    .then((outcomes) => {
      const synced = outcomes.filter((outcome) => outcome.status === 'healthy');
      const failed = outcomes.filter((outcome) => outcome.status === 'error');
      if (outcomes.length > 0) {
        app.log.info(
          {
            synced: synced.length,
            failed: failed.map((outcome) => outcome.sourceId),
            kept: synced.reduce((sum, outcome) => sum + outcome.kept, 0),
          },
          'multi-source-sync-completed',
        );
      }
    })
    .catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'multi-source-sync-failed',
      );
    });
}

function runDocumentRetentionPurge(): void {
  try {
    const purged = candidateStore.purgeExpiredDocuments(
      new Date().toISOString(),
      100,
    );
    if (purged > 0) {
      app.log.info({ purged }, 'document-retention-purge-completed');
    }
  } catch (error) {
    app.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'document-retention-purge-failed',
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown-started');
  if (vacancyRefreshTimer) clearInterval(vacancyRefreshTimer);
  if (multiSourceSyncTimer) clearInterval(multiSourceSyncTimer);
  if (documentRetentionTimer) clearInterval(documentRetentionTimer);
  await app.close();
  candidateStore.close();
  authService.close();
  vacancyPoolStore.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(restoredPool, 'vacancy-pool-restored');
  runVacancyRefresh();
  runMultiSourceSync();
  runDocumentRetentionPurge();
  vacancyRefreshTimer = setInterval(runVacancyRefresh, 5 * 60 * 1_000);
  vacancyRefreshTimer.unref();
  // Each source carries its own interval; the tick only asks which are due.
  multiSourceSyncTimer = setInterval(runMultiSourceSync, 5 * 60 * 1_000);
  multiSourceSyncTimer.unref();
  documentRetentionTimer = setInterval(
    runDocumentRetentionPurge,
    5 * 60 * 1_000,
  );
  documentRetentionTimer.unref();
} catch (error) {
  app.log.fatal(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'server-start-failed',
  );
  process.exit(1);
}
