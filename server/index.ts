import { buildApp } from './app';
import { readServerConfig } from './config';
import { buildCoachProvider } from './providers/coachProviderFactory';
import { buildResumeStructurer } from './providers/resumeStructurer';
import { buildRoleNamer } from './providers/roleNamer';
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
import { VacancyIntelligenceService } from './vacancies/vacancyIntelligenceService';
import { CareerCommandConnectorRouter } from './connectors/careerCommandConnectorRouter';
import { HhConnector } from './connectors/hh/hhConnector';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';
import { createHttpLinkProbe } from './vacancies/linkLivenessProbe';
import { RobotsPolicyLoader } from './vacancies/robotsPolicyLoader';
import { buildMultiSourceFetcher, fetchRobotsTxt } from './vacancies/multiSourceFetcher';
import { SqliteVacancyPoolStore } from './vacancies/sqliteVacancyPoolStore';
import { createHhCrawlSettings } from './vacancies/hhCrawlSettings';
import { HhCrawlCoordinator } from './vacancies/hhCrawlCoordinator';
import { buildHhPageFetcher } from './vacancies/hhSearchTransport';
import { SqliteRoleNamingCache } from './data/sqliteRoleNamingCache';

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
// Built here rather than inside `buildApp`, so the process that owns the
// timers also owns the pool they fill (B164).
const vacancyPoolStore = new SqliteVacancyPoolStore({
  databasePath: config.databasePath,
});
const roleNamingCache = new SqliteRoleNamingCache({
  databasePath: config.databasePath,
  encryptionKey: config.dataEncryptionKey,
});
// Настройки веера обхода hh.ru: набор ролей выбирает владелец, отметка
// глубокого прохода переживает выкат (B214).
const hhCrawlSettings = createHhCrawlSettings({ databasePath: config.databasePath });
const hhCrawlCoordinator = new HhCrawlCoordinator(hhCrawlSettings, {
  fetchPage: buildHhPageFetcher(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
const multiSourceEngine = new MultiSourceVacancyEngine({
  fetcher: buildMultiSourceFetcher(
    searchHhVacancies,
    searchRemotiveVacancies,
    hhCrawlCoordinator,
  ),
  pool: vacancyPoolStore,
  // Право обхода спрашивается у самой площадки, а не берётся из записи,
  // сделанной когда-то руками; `Crawl-delay` тоже приходит оттуда (B204).
  robots: new RobotsPolicyLoader({ fetchRobots: fetchRobotsTxt }),
  // Открывается ли ещё ссылка объявления — отдельное доказательство: лента
  // может отдавать свежие даты у вакансий, которых на сайте уже нет (B200
  // срез 2).
  linkProbe: createHttpLinkProbe(),
});
const app = await buildApp({
  config,
  coachProvider,
  candidateStore,
  authService,
  vacancyIntelligenceService,
  multiSourceVacancyEngine: multiSourceEngine,
  hhCrawlSettings,
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
    // Названные роли переживают рестарт: без хранилища каждый деплой снова звал
    // модель и упирался в исчерпанную бесплатную квоту (INC-035, B191).
    cacheStore: roleNamingCache,
  }),
  serveStatic: process.env.NODE_ENV === 'production',
});

let vacancyRefreshTimer: NodeJS.Timeout | undefined;
let multiSourceSyncTimer: NodeJS.Timeout | undefined;
let linkLivenessTimer: NodeJS.Timeout | undefined;
let documentRetentionTimer: NodeJS.Timeout | undefined;
let retentionSweepTimer: NodeJS.Timeout | undefined;

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

/**
 * Обходит ссылки одной площадки за такт — той, которую проверяли дольше всех.
 * Снятое объявление уходит из пула и остаётся в базе с датой смерти: без этого
 * обхода вакансия, закрытая работодателем час назад, оставалась в подборе до
 * следующей замены среза (B200 срез 2).
 */
function runLinkLivenessProbe(): void {
  void multiSourceEngine
    .probeDueLinks()
    .then((census) => {
      if (census) app.log.info(census, 'vacancy-link-liveness-checked');
    })
    .catch((error: unknown) => {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'vacancy-link-liveness-failed',
      );
    });
}

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

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown-started');
  if (vacancyRefreshTimer) clearInterval(vacancyRefreshTimer);
  if (multiSourceSyncTimer) clearInterval(multiSourceSyncTimer);
  if (linkLivenessTimer) clearInterval(linkLivenessTimer);
  if (documentRetentionTimer) clearInterval(documentRetentionTimer);
  if (retentionSweepTimer) clearInterval(retentionSweepTimer);
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
  // Пул и кластеры восстанавливаются уже после того, как сервер начал отвечать:
  // на большом пуле (120k+ вакансий) чтение и сведение занимают время, и держать
  // ими проверку здоровья выката нельзя (B218).
  setImmediate(() => {
    const startedAt = Date.now();
    const restored = multiSourceEngine.restore();
    multiSourceEngine.recluster();
    app.log.info(
      {
        restored: restored.restored,
        ms: Date.now() - startedAt,
        clusters: multiSourceEngine.getActiveClusters().length,
      },
      'vacancy-pool-restored-and-clustered',
    );
  });
  runVacancyRefresh();
  runMultiSourceSync();
  runDocumentRetentionPurge();
  runRetentionSweep();
  vacancyRefreshTimer = setInterval(runVacancyRefresh, 5 * 60 * 1_000);
  vacancyRefreshTimer.unref();
  // Each source carries its own interval; the tick only asks which are due.
  multiSourceSyncTimer = setInterval(runMultiSourceSync, 5 * 60 * 1_000);
  multiSourceSyncTimer.unref();
  // Одна площадка за такт и двадцать ссылок за обход: полный обход пула — это
  // тысячи чужих запросов, а выборка со своим знаменателем честна и дешева.
  linkLivenessTimer = setInterval(runLinkLivenessProbe, 15 * 60 * 1_000);
  linkLivenessTimer.unref();
  documentRetentionTimer = setInterval(runDocumentRetentionPurge, 5 * 60 * 1_000);
  documentRetentionTimer.unref();
  // Сроки измеряются годами и месяцами, поэтому час — достаточная частота.
  retentionSweepTimer = setInterval(runRetentionSweep, 60 * 60 * 1_000);
  retentionSweepTimer.unref();
} catch (error) {
  app.log.fatal(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'server-start-failed',
  );
  process.exit(1);
}
