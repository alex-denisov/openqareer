import type { HhFetchEvent } from './hhSearchTransport';

/**
 * Журнал выборок hh.ru (B756): сбой — своей строкой warn, ответы — одной
 * сводкой за отрезок, иначе на сотни выборок в час тысячи строк.
 */
interface SummaryLog {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface HhFetchSummary {
  record(event: HhFetchEvent): void;
  flush(): void;
}

/** Ближайший ранг: p-я доля отсортированного ряда. */
function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0;
}

export function createHhFetchSummary(log: SummaryLog): HhFetchSummary {
  let answers: HhFetchEvent[] = [];
  return {
    record(event) {
      if (event.status === 0) {
        log.warn({ ...event }, 'hh_fetch');
        return;
      }
      answers = [...answers, event];
    },
    flush() {
      if (answers.length === 0) return;
      const batch = answers;
      answers = [];
      const totals = batch.map((event) => event.totalMs).sort((a, b) => a - b);
      const statuses: Record<string, number> = {};
      for (const event of batch) statuses[event.status] = (statuses[event.status] ?? 0) + 1;
      log.info(
        {
          count: batch.length,
          statuses,
          p50TotalMs: percentile(totals, 0.5),
          p95TotalMs: percentile(totals, 0.95),
          maxLagMs: Math.max(...batch.map((event) => event.lagMs)),
          freshConnections: batch.filter((event) => event.freshConnection).length,
        },
        'hh_fetch_summary',
      );
    },
  };
}
