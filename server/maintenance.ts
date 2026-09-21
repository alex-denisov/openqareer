import { readServerConfig } from './config';
import { createJsonLineLog } from './maintenance/jsonLineLog';
import { MaintenanceWorker } from './maintenance/maintenanceWorker';
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
const worker = new MaintenanceWorker({ engine: composed.engine, log });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'maintenance-shutdown-started');
  const { waveFinished } = await worker.stop();
  composed.close();
  log.info({ signal, waveFinished }, 'maintenance-shutdown-finished');
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await worker.restore();
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
