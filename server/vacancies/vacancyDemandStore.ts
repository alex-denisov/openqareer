import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/**
 * Роли, под которые нужно собирать вакансии, — общий спрос кандидатов
 * (решение владельца 27.10). Пишет сервер, когда «Карьера» сохраняет роли
 * кандидата; читает обслуживатель пула и ставит эти роли первыми в опрос
 * LinkedIn и Indeed. В таблице только названия должностей: кто их искал, она
 * не хранит.
 */
export const VACANCY_DEMAND_TABLE_SQL = `CREATE TABLE IF NOT EXISTS vacancy_demand_terms (
  term TEXT PRIMARY KEY,
  first_seen_ms INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL
) STRICT`;

/** Роль, которую месяц никто не открывал, уже не задаёт сбор. */
const DEMAND_TTL_MS = 30 * 24 * 60 * 60_000;

export interface VacancyDemandStore {
  record(terms: readonly string[], nowMs: number): void;
  /** Свежие запросы: новые первыми — новый кандидат ждёт меньше всех. */
  recentTerms(nowMs: number, limit: number): string[];
}

export class SqliteVacancyDemandStore implements VacancyDemandStore {
  constructor(private readonly database: DatabaseSync) {
    database.exec(VACANCY_DEMAND_TABLE_SQL);
  }

  record(terms: readonly string[], nowMs: number): void {
    if (terms.length === 0) return;
    const upsert = this.database.prepare(
      `INSERT INTO vacancy_demand_terms (term, first_seen_ms, last_seen_ms) VALUES (?, ?, ?)
       ON CONFLICT(term) DO UPDATE SET last_seen_ms = excluded.last_seen_ms`,
    );
    for (const term of terms) upsert.run(term, nowMs, nowMs);
  }

  recentTerms(nowMs: number, limit: number): string[] {
    const rows = this.database
      .prepare(
        `SELECT term FROM vacancy_demand_terms WHERE last_seen_ms >= ?
         ORDER BY first_seen_ms DESC, term LIMIT ?`,
      )
      .all(nowMs - DEMAND_TTL_MS, limit) as { term: string }[];
    return rows.map((row) => row.term);
  }
}

/** Своё соединение HTTP-процесса: WAL и busy_timeout, как у остальных писателей. */
export function openVacancyDemandStore(databasePath: string): SqliteVacancyDemandStore {
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA journal_mode = WAL;');
  applySqliteBusyTimeout(database);
  return new SqliteVacancyDemandStore(database);
}
