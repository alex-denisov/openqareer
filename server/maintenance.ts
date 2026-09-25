import { DatabaseSync } from 'node:sqlite';
import { readServerConfig } from './config';
import { applySqliteBusyTimeout } from './data/sqliteBusyTimeout';
import { createJsonLineLog } from './maintenance/jsonLineLog';
import { MaintenanceWorker } from './maintenance/maintenanceWorker';
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
const worker = new MaintenanceWorker({
  engine: composed.engine,
  log,
  titleParse: new SemanticBackfill(semanticDatabase),
  ...(config.vertex
    ? {
        titleModel: new TitleModelStep(
          semanticDatabase,
          new VertexModelTitleParser(config.vertex),
          { dailyCalls: readPositiveInteger(process.env.OPENQAREER_TITLE_MODEL_DAILY_CALLS, 2_000) },
        ),
      }
    : {}),
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
  process.exit(1);
}
