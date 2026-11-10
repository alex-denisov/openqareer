import type { DatabaseSync } from 'node:sqlite';

/**
 * B642 — догон требований у старых живых вакансий. С 10.11 пул держит вакансии
 * работодателей старше 30 дней, пока они открыты; их первичный разбор поднял
 * траты фона в 3,2 раза за 2 ч. Фоновый разбор таких вакансий идёт под своей
 * задачей с потолком $2 в сутки; сверх него откладывается до следующих суток,
 * не останавливая остальную работу. Процент, которого ждёт кандидат, не
 * ограничивается — сюда приходит только фоновый хвост.
 */
export const CATCHUP_TASK = 'vacancy-requirements-catchup';
export const CATCHUP_DAY_USD = 2;
const DEFAULT_TASK = 'vacancy-requirements';
const OLD_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const CLUSTER_PREFIX = 'cluster-';

export interface CatchupDecision {
  readonly task: string;
  /** Отложить задачу до этого момента: суточный потолок догона исчерпан. */
  readonly deferUntil?: number;
}

function publishedMs(database: DatabaseSync, vacancyId: string): number | undefined {
  const id = vacancyId.startsWith(CLUSTER_PREFIX)
    ? vacancyId.slice(CLUSTER_PREFIX.length)
    : vacancyId;
  const row = database.prepare('SELECT published_at FROM vacancy_pool WHERE id = ?').get(id) as
    { published_at: string } | undefined;
  const ms = row ? Date.parse(row.published_at) : Number.NaN;
  return Number.isFinite(ms) ? ms : undefined;
}

function spentToday(database: DatabaseSync, day: string): number {
  const row = database
    .prepare(
      'SELECT COALESCE(SUM(COALESCE(cost, reserved)), 0) AS total FROM bulk_llm_spend WHERE task = ? AND day = ?',
    )
    .get(CATCHUP_TASK, day) as { total: number };
  return Number(row.total);
}

export function catchupGate(
  database: DatabaseSync,
  vacancyId: string,
  nowMs: number = Date.now(),
): CatchupDecision {
  const published = publishedMs(database, vacancyId);
  if (published === undefined || nowMs - published <= OLD_AFTER_MS) return { task: DEFAULT_TASK };
  const now = new Date(nowMs);
  if (spentToday(database, now.toISOString().slice(0, 10)) < CATCHUP_DAY_USD) {
    return { task: CATCHUP_TASK };
  }
  const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return { task: CATCHUP_TASK, deferUntil: nextDay };
}
