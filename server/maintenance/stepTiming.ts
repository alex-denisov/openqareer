/**
 * Длительность шагов обслуживания (B641, первый тикет разбора сканов). Для каждого
 * шага: запуски, полное время, синхронная часть до первого await (она и держит
 * очередь событий) и стоянки от 1 с, пришедшиеся на время, пока шаг шёл. Сводка —
 * строкой `maintenance-step-timing` раз в 10 минут, счётчики после неё обнуляются.
 */
interface StepStats {
  runs: number;
  totalMs: number;
  syncMs: number;
  maxSyncMs: number;
  stallMs: number;
}

interface TimingLog {
  info(details: Record<string, unknown>, message: string): void;
}

export const STEP_TIMING_SUMMARY_MS = 600_000;
const IDLE = 'no-step';

let stats = new Map<string, StepStats>();
const inFlight = new Map<string, number>();

function entry(name: string): StepStats {
  const found = stats.get(name);
  if (found) return found;
  const created = { runs: 0, totalMs: 0, syncMs: 0, maxSyncMs: 0, stallMs: 0 };
  stats.set(name, created);
  return created;
}

function finish(name: string, startedAt: number, now: () => number): void {
  entry(name).totalMs += now() - startedAt;
  const left = (inFlight.get(name) ?? 1) - 1;
  if (left > 0) inFlight.set(name, left);
  else inFlight.delete(name);
}

/** Оборачивает шаг: считает запуск, синхронную часть и полное время. */
export function timedStep<T>(
  name: string,
  step: () => T,
  now: () => number = performance.now.bind(performance),
): () => T {
  return () => {
    const startedAt = now();
    inFlight.set(name, (inFlight.get(name) ?? 0) + 1);
    const stat = entry(name);
    stat.runs += 1;
    let result: T;
    try {
      result = step();
    } catch (error) {
      finish(name, startedAt, now);
      throw error;
    }
    const sync = now() - startedAt;
    stat.syncMs += sync;
    stat.maxSyncMs = Math.max(stat.maxSyncMs, sync);
    if (result instanceof Promise) {
      void result.then(
        () => finish(name, startedAt, now),
        () => finish(name, startedAt, now),
      );
    } else {
      finish(name, startedAt, now);
    }
    return result;
  };
}

/** Стоянка делится поровну между шагами, шедшими в этот момент. */
export function recordStepStall(ms: number): void {
  const names = inFlight.size > 0 ? [...inFlight.keys()] : [IDLE];
  for (const name of names) entry(name).stallMs += ms / names.length;
}

export function takeStepTiming(): Record<string, StepStats> {
  const snapshot = Object.fromEntries(
    [...stats].map(([name, s]) => [
      name,
      {
        runs: s.runs,
        totalMs: Math.round(s.totalMs),
        syncMs: Math.round(s.syncMs),
        maxSyncMs: Math.round(s.maxSyncMs),
        stallMs: Math.round(s.stallMs),
      },
    ]),
  );
  stats = new Map();
  return snapshot;
}

export function startStepTimingLog(log: TimingLog, summaryMs = STEP_TIMING_SUMMARY_MS): () => void {
  const timer = setInterval(
    () => log.info({ steps: takeStepTiming(), windowMs: summaryMs }, 'maintenance-step-timing'),
    summaryMs,
  );
  timer.unref();
  return () => clearInterval(timer);
}
