import { readServerConfig } from './config';
import { createJsonLineLog } from './maintenance/jsonLineLog';
import { MaintenanceWorker } from './maintenance/maintenanceWorker';
import { composeVacancyEngine } from './vacancies/composeVacancyEngine';

/**
 * Вход процесса обслуживания пула (B230). Без HTTP: тот же движок, что у
 * сервера, но в отдельном юните с малой кучей, чтобы волна опросов никогда не
 * держала цикл событий, отвечающий кандидатам. Полная пересборка кластеров
 * здесь запрещена (`recluster: off`) — на проде она не помещается в память.
 */
const config = readServerConfig(process.env);
const log = createJsonLineLog();
const composed = composeVacancyEngine({
  databasePath: config.databasePath,
  recluster: { mode: 'off' },
});
const worker = new MaintenanceWorker({ engine: composed.engine, log });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'maintenance-shutdown-started');
  await worker.stop();
  composed.close();
  log.info({ signal }, 'maintenance-shutdown-finished');
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
