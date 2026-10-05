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
import { TitleModelStep, VertexModelTitleParser } from './vacancies/titleParse/modelTitleParser';
import { logPoolWrites } from './maintenance/poolWriteLog';
import { composeVacancyEngine } from './vacancies/composeVacancyEngine';
import { DEFAULT_KEYED_BATCH_SIZE } from './vacancies/multiSourceVacancyEngine';

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
const worker = new MaintenanceWorker({
  engine: composed.engine,
  log,
  titleParse: new SemanticBackfill(semanticDatabase),
  ...(config.vertex
    ? {
        titleModel: new TitleModelStep(
          semanticDatabase,
          new VertexModelTitleParser(config.vertex),
          {
            dailyCalls: readPositiveInteger(process.env.OPENQAREER_TITLE_MODEL_DAILY_CALLS, 2_000),
          },
        ),
      }
    : {}),
  ...(linkedinPoolExecutor ? { linkedinPoolExecutor } : {}),
  purgeRecruiters: () => purgeExpiredRecruiters(semanticDatabase, new Date()),
});

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

let shuttingDown = false;
let restoreInFlight: Promise<unknown> | undefined;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
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
