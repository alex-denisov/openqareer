/**
 * B645: worker-thread entry of the freehire pages pass (dist/freehire-pages-worker.mjs).
 * Own connection, own event loop: maintenance stalls do not hold the requests.
 */
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { runFreehirePagesLoop } from './freehirePagesSchedule';

const { path } = workerData as { path: string };
const database = new DatabaseSync(path);
database.exec('PRAGMA busy_timeout = 10000;');
const post = (level: 'info' | 'error') => (details: Record<string, unknown>, message: string) =>
  parentPort?.postMessage({ level, details, message });
runFreehirePagesLoop(database, { info: post('info'), error: post('error') });
// The loop's timers are unref'd for the main process; this keeps the thread alive.
setInterval(() => {}, 1 << 30);
