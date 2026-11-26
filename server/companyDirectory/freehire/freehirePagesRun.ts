/**
 * B645: the freehire pages pass as its own light process (openqareer-freehire-pages.service,
 * dist/freehire-pages-run.mjs). In the maintenance process it ran at 0.6 pages/s because of
 * event-loop stalls there; alone it reaches the ~3-4/s the client allows. Position lives in
 * freehire_pages_state, so restarts and deploys only resume. Logs are JSON lines for journald.
 */
import { DatabaseSync } from 'node:sqlite';
import { runFreehirePagesLoop } from './freehirePagesSchedule';

const path = process.env.OPENQAREER_DATABASE_PATH;
if (!path) throw new Error('OPENQAREER_DATABASE_PATH is not set');
const database = new DatabaseSync(path);
database.exec('PRAGMA busy_timeout = 15000;');
const line = (level: number) => (details: Record<string, unknown>, msg: string) =>
  process.stdout.write(
    `${JSON.stringify({ level, time: Date.now(), process: 'freehire-pages', ...details, msg })}\n`,
  );
runFreehirePagesLoop(database, { info: line(30), error: line(50) }, 5_000);
// The loop's timers are unref'd; this keeps the process alive.
setInterval(() => {}, 1 << 30);
