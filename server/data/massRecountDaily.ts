import type { DatabaseSync } from 'node:sqlite';

/**
 * Потолок массовых возвратов в работу на UTC-сутки (02.11: пересчёт всей базы стоил $9.9 и $13.4
 * при обычных $1-3). Счётчик в базе: обработчик перезапускается при каждом пуше, память его бы обнулила.
 */
export type MassRecountKind = 'requirements' | 'fit' | 'fit_refresh';

export const MASS_REQUIREMENTS_DAY_LIMIT = 5000;
export const MASS_FIT_DAY_LIMIT = 5000;
export const MASS_FIT_REFRESH_DAY_LIMIT = 5000;

export function ensureMassRecountTable(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS mass_recount_daily (
    utc_day TEXT NOT NULL, kind TEXT NOT NULL, queued INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(utc_day, kind))`);
}

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Потолок из окружения; нечисло и отрицательное дают значение по умолчанию, 0 запрещает возврат. */
export function massRecountLimit(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function massRecountQueued(database: DatabaseSync, kind: MassRecountKind, day: string): number {
  const row = database.prepare('SELECT queued FROM mass_recount_daily WHERE utc_day=? AND kind=?').get(day, kind) as
    | { queued: number }
    | undefined;
  return row?.queued ?? 0;
}

export function massRecountAllowance(database: DatabaseSync, kind: MassRecountKind, limit: number, day: string): number {
  return Math.max(0, limit - massRecountQueued(database, kind, day));
}

export function addMassRecount(database: DatabaseSync, kind: MassRecountKind, day: string, count: number): void {
  if (count <= 0) return;
  database
    .prepare(`INSERT INTO mass_recount_daily(utc_day,kind,queued) VALUES(?,?,?)
      ON CONFLICT(utc_day,kind) DO UPDATE SET queued=queued+excluded.queued`)
    .run(day, kind, count);
}

/** Одна строка фонового обновления процента: true — можно ставить; счёт растёт только при разрешении. */
export function takeMassRecountSlot(
  database: DatabaseSync,
  kind: MassRecountKind,
  limit: number,
  now = Date.now(),
): boolean {
  const day = utcDay(now);
  if (massRecountAllowance(database, kind, limit, day) <= 0) return false;
  addMassRecount(database, kind, day, 1);
  return true;
}
