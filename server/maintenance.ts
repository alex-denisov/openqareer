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
import { getLinkedinChromiumLaunchArgs } from './linkedinPool/linkedinStealthBrowser';
import { launchLinkedinPersistentContext } from './linkedinPool/linkedinPersistentContext';
import { linkedinProfileDirectory } from './linkedinPool/linkedinProfileDirectory';
import { playwrightModuleSpecifier } from './linkedinPool/playwrightModule';
import type { LinkedinPoolExecutorConfig } from './linkedinPool/companyPageExecutorPolicy';
import { notifyOwner } from './notifications/ownerTelegram';
import { SemanticBackfill } from './vacancies/titleParse/semanticBackfill';
import { describeFailure, unfreezeLiveTitles } from './vacancies/titleParse/titleFreeze';
import { buildModelTitleParser, TitleModelStep } from './vacancies/titleParse/modelTitleParser';
import { logPoolWrites } from './maintenance/poolWriteLog';
import { composeVacancyEngine } from './vacancies/composeVacancyEngine';
import { DEFAULT_KEYED_BATCH_SIZE } from './vacancies/multiSourceVacancyEngine';
import { useFanDemand } from './vacancies/jobspyFan';
import { SqliteVacancyDemandStore } from './vacancies/vacancyDemandStore';
import { scheduleSalaryMarketSnapshots } from './salaryMarket/salaryMarketSchedule';
import { scheduleLandingStatsJob } from './landing/landingStatsSchedule';
import { scheduleCurrencyRatesJob } from './currency/cbrRatesSchedule';
import { scheduleCatalogSitemapJob } from './seo/catalogSitemapSchedule';
import { scheduleCatalogRuSummaryJob } from './seo/catalogRuSummarySchedule';
import { scheduleOpenRouterBalanceAlert } from './providers/openRouterBalanceSchedule';
import { scheduleMarketSalaryEstimateJob } from './vacancies/marketSalary/marketSalaryEstimateSchedule';
import { scheduleRemoteScopeBackfill } from './vacancies/remoteScopeBackfillSchedule';

/**
 * Вход процесса обслуживания пула (B230). Без HTTP: тот же движок, что у
 * сервера, но в отдельном юните с малой кучей, чтобы волна опросов никогда не
 * держала цикл событий, отвечающий кандидатам. Кластеры сводятся по ключам
 * (`recluster: keyed`); полная пересборка на проде не помещается в память.
 */
const config = readServerConfig(process.env);
const log = createJsonLineLog();
const linkedinExecutorConfig = readExecutorConfigOrDisable();
const composed = composeVacancyEngine({
  databasePath: config.databasePath,
  // Сведение по ключам: партия × соседи в куче, полная пересборка запрещена.
  recluster: { mode: 'keyed', batchSize: DEFAULT_KEYED_BATCH_SIZE },
  // Итог каждой замены среза и любая транзакция дольше секунды — в журнал:
  // контракт B230 проверяется по `journalctl`, а не по 500 на входе (PRB-043).
  onPoolWrite: logPoolWrites(log),
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
          return chromium.launch({
            headless: true,
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
// Разбор названий по цепочке (B580, 29.10): deepseek-v4-flash → glm-5.3-flash → Vertex.
const titleModelParser = buildModelTitleParser({
  providerCredentials: config.providerCredentials,
  vertex: config.vertex,
});
const worker = new MaintenanceWorker({
  engine: composed.engine,
  log,
  titleParse: new SemanticBackfill(semanticDatabase),
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
          log,
        }),
      }
    : {}),
  ...(linkedinPoolExecutor ? { linkedinPoolExecutor } : {}),
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

let stopSalaryMarketSnapshots: (() => void) | undefined;
let stopCatalogRuSummaries: (() => void) | undefined;
let stopOpenRouterBalance: (() => void) | undefined;
let shuttingDown = false;
let restoreInFlight: Promise<unknown> | undefined;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  stopSalaryMarketSnapshots?.();
  stopCatalogRuSummaries?.();
  stopOpenRouterBalance?.();
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
  worker.start();
  // B535: landing numbers are counted here, never on the web server's event loop.
  scheduleLandingStatsJob(semanticDatabase, log);
  // CPO 27.10: курсы ЦБ для фильтра «Зарплата», раз в сутки, наружу ходит только этот процесс.
  scheduleCurrencyRatesJob(semanticDatabase, log);
  stopSalaryMarketSnapshots = scheduleSalaryMarketSnapshots(semanticDatabase, log);
  // Sitemap files: the listings query groups the whole catalog, so it runs here too.
  scheduleCatalogSitemapJob(semanticDatabase, log);
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
  log.info({ sources: composed.engine.getSources().length }, 'maintenance-started');
} catch (error: unknown) {
  log.error(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'maintenance-start-failed',
  );
  composed.close();
  linkedinPoolRepository?.close();
  process.exit(1);
}
