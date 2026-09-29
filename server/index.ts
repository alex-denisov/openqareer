import { buildApp } from './app';
import { readServerConfig } from './config';
import { buildCoachProvider } from './providers/coachProviderFactory';
import { buildResumeStructurer } from './providers/resumeStructurer';
import { buildRoleNamer } from './providers/roleNamer';
import { VertexCampaignRoleModel } from './providers/campaignRoleModel';
import { buildCoverLetterWriter } from './providers/coverLetterWriter';
import { HygienicCoachProvider } from './providers/hygienicCoachProvider';
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
import { composeVacancyEngine } from './vacancies/composeVacancyEngine';
import { VacancyIntelligenceService } from './vacancies/vacancyIntelligenceService';
import { CareerCommandConnectorRouter } from './connectors/careerCommandConnectorRouter';
import { HhConnector } from './connectors/hh/hhConnector';
import { readProcessHeap } from './vacancies/memoryGuard';
import { SqliteRoleNamingCache } from './data/sqliteRoleNamingCache';
import { SqliteRecruiterContactsRepository } from './data/sqliteRecruiterContactsRepository';
import { SqliteCandidateReputationRepository } from './data/sqliteCandidateReputationRepository';
import { SqliteSearchConsentRepository } from './data/sqliteSearchConsentRepository';
import { buildRecruiterVacancyInput } from './outreach/recruiterIntelligenceInput';
import { runRecruiterIntelligenceJobs } from './outreach/recruiterIntelligenceWorker';
import { SqliteLinkedinPoolRepository } from './linkedinPool/sqliteLinkedinPoolRepository';
import { MatchedPoolPrecompute } from './vacancies/matchedPoolPrecompute';

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
const routedProvider = new HygienicCoachProvider({
  // Ни один ответ модели не доходит до кандидата с невидимыми метками: чистка
  // стоит там, где сходятся все ступени очереди моделей (B210).
  inner: new PrivacyAwareCoachProvider({
    personalDataProvider,
    syntheticDataProvider,
  }),
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
// Движок пула собирается той же фабрикой, что и у обслуживателя (B230):
// HTTP только читает пул, пополняет его отдельный процесс `maintenance.mjs`.
// Полная пересборка кластеров здесь запрещена — в кучу HTTP она не входит.
const vacancyEngine = composeVacancyEngine({
  databasePath: config.databasePath,
  recluster: { mode: 'off' },
  matchMode: config.matchMode,
});
const { engine: multiSourceEngine, hhCrawlSettings } = vacancyEngine;
const matchedPoolPrecompute = new MatchedPoolPrecompute({
  candidateStore,
  engine: multiSourceEngine,
});
const roleNamingCache = new SqliteRoleNamingCache({
  databasePath: config.databasePath,
  encryptionKey: config.dataEncryptionKey,
});
const recruiterContactsRepo = new SqliteRecruiterContactsRepository({
  databasePath: config.databasePath,
});
const candidateReputationRepo = new SqliteCandidateReputationRepository({
  databasePath: config.databasePath,
});
const searchConsentRepo = new SqliteSearchConsentRepository({
  databasePath: config.databasePath,
});
const linkedinPool = new SqliteLinkedinPoolRepository({
  databasePath: config.databasePath,
  encryptionKey: config.dataEncryptionKey,
  runtimeRoot: config.linkedinRuntimeRoot,
});
const app = await buildApp({
  config,
  coachProvider,
  candidateStore,
  authService,
  vacancyIntelligenceService,
  multiSourceVacancyEngine: multiSourceEngine,
  hhCrawlSettings,
  recruiterContactsRepo,
  candidateReputationRepo,
  searchConsentRepo,
  linkedinPool,
  matchedPoolPrecompute,
  runtimeMemory: () => {
    const heap = readProcessHeap();
    return {
      // Опросы живут в обслуживателе (B230): у HTTP-процесса паузы нет.
      ingestPaused: false,
      heapUsedMb: Math.round(heap.heapUsedBytes / (1024 * 1024)),
      heapLimitMb: Math.round(heap.heapLimitBytes / (1024 * 1024)),
      poolSize: multiSourceEngine.poolSize,
      recluster: multiSourceEngine.reclusterStats,
    };
  },
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
    vertex: config.vertex,
    // Названные роли переживают рестарт: без хранилища каждый деплой снова звал
    // модель и упирался в исчерпанную бесплатную квоту (INC-035, B191).
    cacheStore: roleNamingCache,
  }),
  campaignRoleModel: config.vertex ? new VertexCampaignRoleModel(config.vertex) : undefined,
  // Та же очередь провайдеров, что и у называния ролей: письмо пишет модель,
  // шаблон остаётся запасом (B266, пункт 7).
  coverLetterWriter: buildCoverLetterWriter({
    personalProvider: personalProviderId,
    model: config.model,
    fallbacks: config.personalFallbacks,
    providerCredentials: config.providerCredentials,
    cloudflareGateway: config.cloudflareGateway,
    vertex: config.vertex,
  }),
  serveStatic: process.env.NODE_ENV === 'production',
});
matchedPoolPrecompute.setLogger(app.log);

let vacancyRefreshTimer: NodeJS.Timeout | undefined;
let recruiterIntelligenceTimer: NodeJS.Timeout | undefined;
let documentRetentionTimer: NodeJS.Timeout | undefined;
let retentionSweepTimer: NodeJS.Timeout | undefined;
let matchedPoolPrecomputeTimer: NodeJS.Timeout | undefined;
let linkedinPoolSessionExpiryTimer: NodeJS.Timeout | undefined;
let linkedinPoolSessionExpiryRetryTimer: NodeJS.Timeout | undefined;

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

function runRecruiterIntelligence(): void {
  void runRecruiterIntelligenceJobs({
    repository: recruiterContactsRepo,
    resolveVacancy: (vacancyId) => buildRecruiterVacancyInput(vacancyId, { multiSourceEngine }),
    maxJobs: 1,
    linkedinPool,
  })
    .then((result) => {
      if (result.claimed > 0) app.log.info(result, 'recruiter-intelligence-completed');
    })
    .catch((error: unknown) => {
      // The SQLite message and code name the cause (locked, busy, schema);
      // they carry no candidate data (B266: 273 failures a day, cause unseen).
      app.log.error(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorCode: (error as { code?: unknown } | null)?.code,
          errorMessage: error instanceof Error ? error.message.slice(0, 200) : undefined,
        },
        'recruiter-intelligence-failed',
      );
    });
}

// Опросы площадок, живость ссылок и проекция каталога с B230 живут в
// `server/maintenance.ts`: у HTTP-процесса нет ни таймеров, ни памяти на них.

function runDocumentRetentionPurge(): void {
  try {
    const purged = candidateStore.purgeExpiredDocuments(new Date().toISOString(), 100);
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

/**
 * B195 / PRB-014 — опубликованные сроки хранения соблюдаются кодом: согласие
 * живёт три года с прекращения договора, журнал безопасности — 12 месяцев.
 * Числа берутся из `RETENTION_POLICIES`, то есть из того же места, что и текст
 * политики.
 */
function runRetentionSweep(): void {
  try {
    const purged = authService.purgeExpiredRetention(new Date().toISOString());
    if (purged.consents > 0 || purged.securityLog > 0) {
      app.log.info(purged, 'retention-sweep-completed');
    }
  } catch (error) {
    app.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'retention-sweep-failed',
    );
  }
}

function runLinkedinPoolSessionExpiryPurge(): void {
  try {
    const purged = linkedinPool.purgeExpiredSessionCookies();
    if (purged > 0) app.log.info({ purged }, 'linkedin-pool-session-expiry-purge-completed');
    if (linkedinPoolSessionExpiryRetryTimer) {
      clearTimeout(linkedinPoolSessionExpiryRetryTimer);
      linkedinPoolSessionExpiryRetryTimer = undefined;
    }
  } catch (error) {
    app.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'linkedin-pool-session-expiry-purge-failed',
    );
    if (!linkedinPoolSessionExpiryRetryTimer) {
      linkedinPoolSessionExpiryRetryTimer = setTimeout(() => {
        linkedinPoolSessionExpiryRetryTimer = undefined;
        runLinkedinPoolSessionExpiryPurge();
      }, 60_000);
      linkedinPoolSessionExpiryRetryTimer.unref();
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown-started');
  if (vacancyRefreshTimer) clearInterval(vacancyRefreshTimer);
  if (recruiterIntelligenceTimer) clearInterval(recruiterIntelligenceTimer);
  if (documentRetentionTimer) clearInterval(documentRetentionTimer);
  if (retentionSweepTimer) clearInterval(retentionSweepTimer);
  if (matchedPoolPrecomputeTimer) clearInterval(matchedPoolPrecomputeTimer);
  if (linkedinPoolSessionExpiryTimer) clearInterval(linkedinPoolSessionExpiryTimer);
  if (linkedinPoolSessionExpiryRetryTimer) clearTimeout(linkedinPoolSessionExpiryRetryTimer);
  await app.close();
  candidateStore.close();
  authService.close();
  vacancyEngine.close();
  recruiterContactsRepo.close();
  candidateReputationRepo.close();
  searchConsentRepo.close();
  linkedinPool.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  // Сервер слушает и отвечает на /health мгновенно (<10 мс). Пул читается
  // из базы постранично, пополняет его обслуживатель (B230) — на этом цикле
  // событий ни восстановления, ни сведения, ни опросов нет.
  setTimeout(() => {
    app.log.info(
      { mode: 'lazy-read', clusters: 'deferred', sourceSync: 'maintenance-process' },
      'vacancy-pool-ready',
    );
    runDocumentRetentionPurge();
    runRetentionSweep();
  }, 30_000)?.unref();
  // Первый semantic-read не платит за создание отдельного SQLite-процесса.
  // Это только запуск reader: данные и SQL остаются запросом кандидата, а
  // HTTP уже слушает, когда OS начинает создавать дочерний процесс.
  setImmediate(() => vacancyEngine.pool.warmMatchReader()).unref();
  // Снимки считаются через тот же изолированный reader, но до первого
  // кандидатского запроса и далее без параллельного дискового шквала.
  setImmediate(() => {
    void matchedPoolPrecompute.run();
  }).unref();
  matchedPoolPrecomputeTimer = setInterval(
    () => {
      void matchedPoolPrecompute.run();
    },
    5 * 60 * 1_000,
  );
  matchedPoolPrecomputeTimer.unref();
  vacancyRefreshTimer = setInterval(runVacancyRefresh, 5 * 60 * 1_000);
  vacancyRefreshTimer.unref();
  recruiterIntelligenceTimer = setInterval(runRecruiterIntelligence, 5_000);
  recruiterIntelligenceTimer.unref();
  documentRetentionTimer = setInterval(runDocumentRetentionPurge, 5 * 60 * 1_000);
  documentRetentionTimer.unref();
  // Сроки измеряются годами и месяцами, поэтому час — достаточная частота.
  retentionSweepTimer = setInterval(runRetentionSweep, 60 * 60 * 1_000);
  retentionSweepTimer.unref();
  // Expired LinkedIn bearer cookies are removed at most fifteen minutes after li_at expiry.
  linkedinPoolSessionExpiryTimer = setInterval(runLinkedinPoolSessionExpiryPurge, 15 * 60 * 1_000);
  linkedinPoolSessionExpiryTimer.unref();
} catch (error) {
  app.log.fatal(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'server-start-failed',
  );
  process.exit(1);
}
