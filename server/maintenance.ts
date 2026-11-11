import { PlacementBackfill, PlacementBackfillTicker } from './companyDirectory/placement/placementBackfill';
import { CareersPrune, CareersPruneTicker } from './companyDirectory/siteDiscovery/careersPrune';
import { AggregatorCompanyBackfill, AggregatorCompanyTicker } from './companyDirectory/placement/aggregatorBackfill';
import { DatabaseSync } from 'node:sqlite';
import { readServerConfig } from './config';
import { applySqliteBusyTimeout } from './data/sqliteBusyTimeout';
import { createJsonLineLog } from './maintenance/jsonLineLog';
import { MaintenanceWorker } from './maintenance/maintenanceWorker';
import { SqliteLinkedinPoolRepository } from './linkedinPool/sqliteLinkedinPoolRepository';
import { purgeExpiredRecruiters } from './linkedinPool/companyRecruiterDiscovery';
import {
  LinkedinPoolCompanyPageExecutor,
  readLinkedinPoolExecutorConfig,
} from './linkedinPool/companyPageExecutor';
import {
  getLinkedinBrowserLaunch,
  getLinkedinChromiumLaunchArgs,
} from './linkedinPool/linkedinStealthBrowser';
import { launchLinkedinPersistentContext } from './linkedinPool/linkedinPersistentContext';
import { linkedinProfileDirectory } from './linkedinPool/linkedinProfileDirectory';
import { playwrightModuleSpecifier } from './linkedinPool/playwrightModule';
import { createScriptPageRenderer, launchSiteRenderBrowser } from './vacancies/scriptPageRenderer';
import { createRenderInWorker } from './vacancies/siteRenderInWorker';
import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { LinkedinPoolExecutorConfig } from './linkedinPool/companyPageExecutorPolicy';
import { notifyOwner } from './notifications/ownerTelegram';
import { startEventLoopDelayLog } from './maintenance/eventLoopDelayLog';
import { recordStepStall, startStepTimingLog } from './maintenance/stepTiming';
import { recordEventLoopStall } from './vacancies/freehire/atsFuse';
import { RoleLinkStep } from './vacancies/titleParse/roleLinkStep';
import { SemanticBackfill } from './vacancies/titleParse/semanticBackfill';
import { describeFailure, unfreezeLiveTitles } from './vacancies/titleParse/titleFreeze';
import {
  BulkTitleParser,
  DEFAULT_PARTIAL_BATCH_WAIT_MS,
  TitleModelStep,
} from './vacancies/titleParse/modelTitleParser';
import { createBulkLlmRuntime } from './providers/bulkLlmRuntime';
import { logPoolWrites } from './maintenance/poolWriteLog';
import { watchWriteHolds } from './observability/sqliteWriteHolds';
import { composeVacancyEngine } from './vacancies/composeVacancyEngine';
import { DEFAULT_KEYED_BATCH_SIZE } from './vacancies/multiSourceVacancyEngine';
import { useFanDemand } from './vacancies/jobspyFan';
import { SqliteVacancyDemandStore } from './vacancies/vacancyDemandStore';
import { scheduleSalaryMarketSnapshots } from './salaryMarket/salaryMarketSchedule';
import { scheduleLandingStatsJob } from './landing/landingStatsSchedule';
import { scheduleCurrencyRatesJob } from './currency/cbrRatesSchedule';
import { scheduleCatalogSearchEvidence } from './seo/catalogSearchEvidence';
import { scheduleCatalogSitemapJob } from './seo/catalogSitemapSchedule';
import { scheduleCatalogRuSummaryJob } from './seo/catalogRuSummarySchedule';
import { scheduleOpenRouterBalanceAlert } from './providers/openRouterBalanceSchedule';
import { scheduleMarketSalaryEstimateJob } from './vacancies/marketSalary/marketSalaryEstimateSchedule';
import { scheduleRemoteScopeBackfill } from './vacancies/remoteScopeBackfillSchedule';
import { pauseClusterWrite } from './vacancies/clusterWritePause';
import { createLinkedinGuestBudget } from './vacancies/linkedinGuestBudget';
import {
  createWebsharePool,
  readStaticProxyList,
  readWebshareCredentials,
} from './vacancies/webshareProxyPool';
import { loadBudgetState, saveBudgetState } from './vacancies/linkedinBudgetState';
import { scheduleLinkedinOrgResolver } from './companyDirectory/linkedinOrg/linkedinOrgSchedule';
import { scheduleSiteDiscovery } from './companyDirectory/siteDiscovery/siteDiscoverySchedule';
import { scheduleFreehireRepo } from './companyDirectory/freehire/freehireRepoSchedule';
import { scheduleFreehirePages } from './companyDirectory/freehire/freehirePagesSchedule';

/**
 * Вход процесса обслуживания пула (B230). Без HTTP: тот же движок, что у
 * сервера, но в отдельном юните с малой кучей, чтобы волна опросов никогда не
 * держала цикл событий, отвечающий кандидатам. Кластеры сводятся по ключам
 * (`recluster: keyed`); полная пересборка на проде не помещается в память.
 */
const config = readServerConfig(process.env);
const log = createJsonLineLog();
watchWriteHolds((hold) =>
  log.warn({ ...hold, heldMs: Math.round(hold.heldMs) }, 'write-lock-held-long'),
);
const linkedinExecutorConfig = readExecutorConfigOrDisable();
// Один бюджет гостевого LinkedIn на процесс: каналы компаний, общий поиск и
// резолвер org_id (B621) делят его по долям, 429 — пауза всем (B622).
// Пауза и интервал переживают перезапуск: 09.11 пять стартов за час, и каждый
// начинал с базового интервала прямо в 429.
const budgetStateDatabase = new DatabaseSync(config.databasePath);
applySqliteBusyTimeout(budgetStateDatabase);
const savedBudget = loadBudgetState(budgetStateDatabase);
// B626: гостевой LinkedIn через ротацию прокси Webshare; без ключа — напрямую.
// Платный список из окружения важнее бесплатного списка API.
const staticProxies = readStaticProxyList();
const webshareCredentials = readWebshareCredentials();
const websharePool =
  staticProxies.length > 0
    ? createWebsharePool({ credentials: { apiKey: 'static' }, loadList: async () => staticProxies })
    : webshareCredentials
      ? createWebsharePool({ credentials: webshareCredentials })
      : undefined;
const linkedinFetch: typeof fetch = websharePool?.fetch ?? fetch;
const linkedinBudget = createLinkedinGuestBudget({
  ...(websharePool ? { parallelism: () => websharePool.parallelism() } : {}),
  ...(savedBudget ? { initial: savedBudget } : {}),
  onChange: (stats) => {
    try {
      saveBudgetState(budgetStateDatabase, stats, new Date());
    } catch (error: unknown) {
      log.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'linkedin-budget-save-failed',
      );
    }
    log.info({ ...stats }, 'linkedin-budget');
  },
});
// B643: страницы карьеры, нарисованные скриптом, — один рендер в обычном headless Chrome.
// Откат: OPENQAREER_SITE_RENDER_OFF=1. Нет браузера — одна строка журнала, шаг пропускается.
// Рендер в своём потоке (dist/site-render-worker.mjs): цикл обслуживания занят, а каждый
// запрос страницы идёт через Node. Без файла потока (tsx в разработке) — в этом процессе.
const siteRenderWorkerFile = new URL('./site-render-worker.mjs', import.meta.url);
const renderLog = (fields: Record<string, unknown>, message: string): void =>
  log.warn(fields, message);
const renderScriptPage = existsSync(siteRenderWorkerFile)
  ? createRenderInWorker({
      spawn: () =>
        new Worker(siteRenderWorkerFile, {
          workerData: {
            moduleSpecifier: playwrightModuleSpecifier(),
            executablePath: getLinkedinBrowserLaunch().executablePath,
          },
        }),
      log: renderLog,
    })
  : createScriptPageRenderer({
      launch: () =>
        launchSiteRenderBrowser(
          playwrightModuleSpecifier(),
          getLinkedinBrowserLaunch().executablePath,
        ),
      log: renderLog,
    });
const composed = composeVacancyEngine({
  databasePath: config.databasePath,
  linkedinBudget,
  linkedinFetch,
  renderScriptPage,
  // Сведение по ключам: партия × соседи в куче, полная пересборка запрещена.
  recluster: { mode: 'keyed', batchSize: DEFAULT_KEYED_BATCH_SIZE },
  // Итог каждой замены среза и любая транзакция дольше секунды — в журнал:
  // контракт B230 проверяется по `journalctl`, а не по 500 на входе (PRB-043).
  onPoolWrite: logPoolWrites(log),
  // HTTP ждёт запись на главном потоке: между транзакциями кластеров ему нужен зазор.
  clusterWritePause: pauseClusterWrite,
});
// Своё соединение для разметки смыслового индекса (B267 S2): короткие
// транзакции порциями, WAL и busy_timeout как у остальных писателей пула.
const semanticDatabase = new DatabaseSync(config.databasePath);
semanticDatabase.exec('PRAGMA journal_mode = WAL;');
applySqliteBusyTimeout(semanticDatabase);
// Роли кандидатов идут первыми в опросы LinkedIn и Indeed (27.10): новые первыми.
const MAX_DEMAND_TERMS = 40;
const vacancyDemand = new SqliteVacancyDemandStore(semanticDatabase);
useFanDemand(() => vacancyDemand.recentTerms(Date.now(), MAX_DEMAND_TERMS));
// Ошибка настройки исполнителя LinkedIn не должна останавливать обслуживание
// пула вакансий: исполнитель остаётся выключенным, код ошибки — в журнал.
function readExecutorConfigOrDisable(): LinkedinPoolExecutorConfig {
  try {
    return readLinkedinPoolExecutorConfig(process.env);
  } catch (error: unknown) {
    log.error(
      { reason: error instanceof Error ? error.message : 'unknown' },
      'linkedin-pool-executor-config-invalid',
    );
    return { enabled: false };
  }
}
const linkedinPoolRepository = linkedinExecutorConfig.enabled
  ? new SqliteLinkedinPoolRepository({
      databasePath: config.databasePath,
      encryptionKey: config.dataEncryptionKey,
      ...(config.linkedinRuntimeRoot ? { runtimeRoot: config.linkedinRuntimeRoot } : {}),
    })
  : undefined;
const linkedinPoolExecutor =
  linkedinExecutorConfig.enabled && linkedinPoolRepository
    ? new LinkedinPoolCompanyPageExecutor({
        config: linkedinExecutorConfig,
        repository: linkedinPoolRepository,
        database: linkedinPoolRepository.getDatabase(),
        // Только по требованию: на проде playwright ставится отдельно (B309, B313).
        browserFactory: async () => {
          const { chromium } = await import(playwrightModuleSpecifier());
          // B626: Google Chrome в окне Xvfb; встроенный Chromium Cloudflare блокирует.
          return chromium.launch({
            ...getLinkedinBrowserLaunch(),
            args: getLinkedinChromiumLaunchArgs(),
          });
        },
        // B373: постоянный профиль аккаунта; без него остаётся путь через cookie.
        profiles: {
          directoryFor: (accountId) => linkedinProfileDirectory(config.databasePath, accountId),
          launchContext: async (profileDirectory, timezone) => {
            const { chromium } = await import(playwrightModuleSpecifier());
            return launchLinkedinPersistentContext(chromium, profileDirectory, { timezone });
          },
        },
        exa: { apiKey: config.exaApiKey },
        notifyOwner: (message) => notifyOwner(config, message),
      })
    : undefined;
// Разбор названий идёт через фоновый канал (04.11): журнал расхода, повторы и ответившая модель
// ведёт BulkLlmClient. Канал выключен — шага разбора названий нет.
const titleBulkRuntime = createBulkLlmRuntime({ databasePath: config.databasePath });
const titleModelParser = titleBulkRuntime.client
  ? new BulkTitleParser(titleBulkRuntime.client)
  : undefined;
const worker = new MaintenanceWorker({
  engine: composed.engine,
  log,
  // Откат малой партии связи с ролью: OPENQAREER_ROLE_LINK_OFF=1 останавливает вызовы модели.
  ...(titleBulkRuntime.client && process.env.OPENQAREER_ROLE_LINK_OFF !== '1'
    ? { roleLink: new RoleLinkStep(semanticDatabase, titleBulkRuntime.client, log) }
    : {}),
  titleParse: new SemanticBackfill(
    semanticDatabase,
    (reason) => log.error({ reason }, 'title-grade-step-failed'),
    (stages) => log.info({ ...stages }, 'title-parse-slow-step'),
  ),
  ...(titleModelParser
    ? {
        titleModel: new TitleModelStep(semanticDatabase, titleModelParser, {
          dailyCalls: readPositiveInteger(process.env.OPENQAREER_TITLE_MODEL_DAILY_CALLS, 2_000),
          // Потолок вызовов за жизнь процесса (перепрогон после разморозки; 1 вызов = до 40 названий).
          ...(process.env.OPENQAREER_TITLE_MODEL_RUN_CALLS
            ? {
                maxCallsPerRun: readPositiveInteger(
                  process.env.OPENQAREER_TITLE_MODEL_RUN_CALLS,
                  Number.MAX_SAFE_INTEGER,
                ),
              }
            : {}),
          // Неполная пачка (меньше 40 названий) ждёт добора, мс; полная уходит сразу.
          ...(process.env.OPENQAREER_TITLE_MODEL_BATCH_WAIT_MS
            ? {
                maxWaitMs: readNonNegativeInteger(
                  process.env.OPENQAREER_TITLE_MODEL_BATCH_WAIT_MS,
                  DEFAULT_PARTIAL_BATCH_WAIT_MS,
                ),
              }
            : {}),
          log,
        }),
      }
    : {}),
  ...(linkedinPoolExecutor ? { linkedinPoolExecutor } : {}),
  // B643-3: размещения компаний; откат — OPENQAREER_COMPANY_PLACEMENT_OFF=1.
  ...(process.env.OPENQAREER_COMPANY_PLACEMENT_OFF === '1'
    ? {}
    : { placements: new PlacementBackfillTicker(new PlacementBackfill(semanticDatabase)) }),
  // B643-8: компания для строк агрегаторов по точному имени; откат — OPENQAREER_AGGREGATOR_COMPANY_OFF=1.
  ...(process.env.OPENQAREER_COMPANY_PLACEMENT_OFF === '1' || process.env.OPENQAREER_AGGREGATOR_COMPANY_OFF === '1'
    ? {}
    : { aggregatorCompanies: new AggregatorCompanyTicker(new AggregatorCompanyBackfill(semanticDatabase)) }),
  // B643: careers pages that are not vacancy pages or stay closed leave the directory; off — OPENQAREER_CAREERS_PRUNE_OFF=1.
  ...(process.env.OPENQAREER_CAREERS_PRUNE_OFF === '1'
    ? {}
    : { careersPrune: new CareersPruneTicker(new CareersPrune(semanticDatabase)) }),
  purgeRecruiters: () => purgeExpiredRecruiters(semanticDatabase, new Date()),
});

// Разовая разморозка названий с живыми вакансиями: включается на хосте флагом и после прогона снимается.
if (process.env.OPENQAREER_TITLE_UNFREEZE === '1') {
  void unfreezeLiveTitles(semanticDatabase)
    .then((report) => log.info({ ...report }, 'title-model-unfreeze-done'))
    .catch((error: unknown) =>
      log.error({ reason: describeFailure(error) }, 'title-model-unfreeze-failed'),
    );
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

let stopSalaryMarketSnapshots: (() => void) | undefined;
let stopCatalogRuSummaries: (() => void) | undefined;
let stopOpenRouterBalance: (() => void) | undefined;
let stopCatalogSearchEvidence: (() => void) | undefined;
let stopLinkedinOrgResolver: (() => void) | undefined;
let shuttingDown = false;
let restoreInFlight: Promise<unknown> | undefined;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopSalaryMarketSnapshots?.();
  stopCatalogRuSummaries?.();
  stopOpenRouterBalance?.();
  stopCatalogSearchEvidence?.();
  stopLinkedinOrgResolver?.();
  log.info({ signal }, 'maintenance-shutdown-started');
  // `restoreAsync` reads the large SQLite pool in bounded chunks, but a
  // single restore can still take more than the old systemd stop window on
  // production. Wait for it before closing the shared database; otherwise a
  // deploy can interrupt restore between its chunks and close the connection
  // underneath the still-running promise.
  await restoreInFlight?.catch(() => undefined);
  const { waveFinished } = await worker.stop();
  if (!waveFinished) {
    // Не закрываем SQLite, пока незавершённая волна ещё может вернуться из
    // fetcher и записать результат. Процесс должен завершиться целиком, иначе
    // следующий systemd restart получает закрытое соединение вместо честного
    // fail-and-restart.
    log.error({ signal }, 'maintenance-shutdown-forced');
    process.exit(1);
    return;
  }
  semanticDatabase.close();
  titleBulkRuntime.close();
  linkedinPoolRepository?.close();
  composed.close();
  log.info({ signal, waveFinished }, 'maintenance-shutdown-finished');
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  restoreInFlight = worker.restore();
  await restoreInFlight;
  restoreInFlight = undefined;
  worker.reportMemory();
  startEventLoopDelayLog(log, {
    onStall: (ms) => {
      recordStepStall(ms);
      recordEventLoopStall(ms);
    },
  });
  startStepTimingLog(log);
  worker.start();
  // B535: landing numbers are counted here, never on the web server's event loop.
  scheduleLandingStatsJob(semanticDatabase, log);
  // CPO 27.10: курсы ЦБ для фильтра «Зарплата», раз в сутки, наружу ходит только этот процесс.
  scheduleCurrencyRatesJob(semanticDatabase, log);
  stopSalaryMarketSnapshots = scheduleSalaryMarketSnapshots(semanticDatabase, log);
  // Sitemap files: the listings query groups the whole catalog, so it runs here too.
  scheduleCatalogSitemapJob(semanticDatabase, log, config);
  // 04.11: listings with impressions in Google keep `index` below their threshold.
  stopCatalogSearchEvidence = scheduleCatalogSearchEvidence(
    semanticDatabase,
    process.env.OPENQAREER_GSC_SERVICE_ACCOUNT_B64,
    log,
  );
  // 03.11: Russian card summaries through the bulk channel, newest indexable cards first.
  stopCatalogRuSummaries = scheduleCatalogRuSummaryJob(semanticDatabase, config.databasePath, log);
  // 04.11: hourly OpenRouter balance check, one Telegram alert per UTC day below the threshold.
  stopOpenRouterBalance = scheduleOpenRouterBalanceAlert(
    semanticDatabase,
    config.providerCredentials?.openrouter,
    config,
    log,
  );
  // B546: market salary estimates stream every salaried vacancy, so only here.
  scheduleMarketSalaryEstimateJob(semanticDatabase, log);
  // 03.11: область удалёнки для проекций, записанных до неё, пачками по 200.
  scheduleRemoteScopeBackfill(semanticDatabase, log);
  // B627 / B643-9: домен, карьеры и ATS без модели (решение владельца 11.11), ≤480 компаний в сутки.
  if (process.env.OPENQAREER_SITE_DISCOVERY_OFF !== '1') scheduleSiteDiscovery(semanticDatabase, log);
  // B644: компании и доски ATS из каталога репозитория freehire (файл), вместо API freehire.me (B641).
  scheduleFreehireRepo(semanticDatabase, log, process.env);
  // B645: все ~520 тыс. компаний freehire по публичным страницам (__data.json), ~3 запроса/с, без модели.
  scheduleFreehirePages(semanticDatabase, log, process.env);
  // B621: LinkedIn ID компаний реестра через гостевой доступ, одна компания за такт.
  if (process.env.OPENQAREER_LINKEDIN_ORG_RESOLVER_OFF !== '1') {
    stopLinkedinOrgResolver = scheduleLinkedinOrgResolver(
      semanticDatabase,
      log,
      linkedinBudget,
      linkedinFetch,
    );
    // Замер бюджета раз в 15 минут: процесс перезапускается чаще часа (B622).
    setInterval(
      () =>
        log.info(
          {
            ...linkedinBudget.stats(),
            ...(websharePool ? { webshare: websharePool.stats() } : {}),
          },
          'linkedin-budget',
        ),
      15 * 60_000,
    ).unref();
  }
  log.info(
    {
      sources: composed.engine.getSources().length,
      linkedinEgress:
        staticProxies.length > 0 ? 'static-proxies' : websharePool ? 'webshare' : 'direct',
    },
    'maintenance-started',
  );
} catch (error: unknown) {
  log.error(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'maintenance-start-failed',
  );
  composed.close();
  linkedinPoolRepository?.close();
  process.exit(1);
}
