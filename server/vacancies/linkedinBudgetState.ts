/**
 * B622: пауза и интервал общего бюджета LinkedIn переживают перезапуск
 * обслуживания. 09.11 процесс стартовал пять раз за час, и каждый старт
 * начинал с базового интервала — первый же залп каналов ловил 429.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { LinkedinBudgetStats } from './linkedinGuestBudget';

const TABLE = 'linkedin_guest_budget_state';

export interface SavedBudgetState {
  readonly pausedUntil: number;
  readonly gapMs: number;
}

function ensureTable(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       paused_until INTEGER NOT NULL,
       gap_ms INTEGER NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );
}

export function loadBudgetState(db: DatabaseSync): SavedBudgetState | undefined {
  ensureTable(db);
  const row = db.prepare(`SELECT paused_until, gap_ms FROM ${TABLE} WHERE id = 1`).get() as
    { paused_until: number; gap_ms: number } | undefined;
  return row ? { pausedUntil: Number(row.paused_until), gapMs: Number(row.gap_ms) } : undefined;
}

export function saveBudgetState(db: DatabaseSync, stats: LinkedinBudgetStats, now: Date): void {
  ensureTable(db);
  db.prepare(
    `INSERT INTO ${TABLE} (id, paused_until, gap_ms, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET paused_until = excluded.paused_until,
       gap_ms = excluded.gap_ms, updated_at = excluded.updated_at`,
  ).run(stats.pausedUntil, stats.gapMs, now.toISOString());
}
