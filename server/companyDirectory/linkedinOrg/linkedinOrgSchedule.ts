/**
 * B621: шаг поиска LinkedIn ID в процессе обслуживания. Одна компания за
 * такт; между тактами пауза, во время общей паузы LinkedIn — сон до её
 * конца. Новые строки реестра попадают в очередь сами (запрос по пустому ID).
 * Откат: OPENQAREER_LINKEDIN_ORG_RESOLVER_OFF=1.
 */
import type { DatabaseSync } from 'node:sqlite';
import { createGuestFetch } from './guestFetch';
import { LinkedinOrgRunner, type RunnerLog } from './linkedinOrgRunner';
import { LinkedinOrgStore } from './linkedinOrgStore';
import type { LinkedinGuestBudget } from '../../vacancies/linkedinGuestBudget';

interface ScheduleLog extends RunnerLog {
  error(details: Record<string, unknown>, message: string): void;
}

const FIRST_RUN_MS = 5 * 60_000;
const BETWEEN_COMPANIES_MS = 30_000;
const IDLE_MS = 60 * 60_000;
const ERROR_MS = 10 * 60_000;
const LOG_EVERY = 25;

export function scheduleLinkedinOrgResolver(
  database: DatabaseSync,
  log: ScheduleLog,
  budget?: LinkedinGuestBudget,
): () => void {
  const store = new LinkedinOrgStore(database);
  const runner = new LinkedinOrgRunner({
    store,
    fetchPage: createGuestFetch(),
    log,
    ...(budget ? { budget } : {}),
  });
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  let processed = 0;
  const next = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => void run(), delay);
    timer.unref();
  };
  const run = async () => {
    try {
      const result = await runner.step();
      if (result.kind === 'idle') return next(IDLE_MS);
      if (result.kind === 'cooldown') {
        return next(Math.max(BETWEEN_COMPANIES_MS, result.until.getTime() - Date.now()));
      }
      processed += 1;
      if (processed % LOG_EVERY === 0)
        log.info({ processed, ...store.counts() }, 'linkedin-org-progress');
      next(BETWEEN_COMPANIES_MS);
    } catch (error: unknown) {
      log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'linkedin-org-step-failed',
      );
      next(ERROR_MS);
    }
  };
  next(FIRST_RUN_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
