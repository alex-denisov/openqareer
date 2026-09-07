import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import {
  MIGRATION_23,
  VACANCY_POOL_EXPIRED_AT_COLUMN,
  VACANCY_SOURCE_OBSERVATIONS_COLUMN,
} from '../data/sqliteSchema';
import type { SourceObservations } from './sourceHealthVerdict';
import type { StoredSourceState, VacancyPoolStore } from './vacancyPoolStore';

interface VacancyRow {
  payload: string;
}

interface SourceStateRow {
  source_id: string;
  last_sync_at: string | null;
  last_status: string | null;
  last_error_message: string | null;
  items_found_total: number;
  items_active_total: number;
  observations: string | null;
}

const SOURCE_STATUSES = new Set(['healthy', 'degraded', 'error']);

/**
 * Наблюдения лежат одним JSON-значением, как `payload` у самой вакансии.
 * Запись, которую не удалось прочитать, наблюдением не считается: обнулённая
 * живость честнее наполовину разобранной (B200).
 */
function parseObservations(raw: string | null): SourceObservations | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed as SourceObservations;
  } catch {
    return undefined;
  }
}

/**
 * The vacancy pool on disk. Opens its own connection to the same file the
 * candidate store uses, the way the auth service does, so the tables are
 * created by the process that actually owns the pool (B164).
 */
export class SqliteVacancyPoolStore implements VacancyPoolStore {
  private readonly database: DatabaseSync;

  constructor(options: { databasePath: string }) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(MIGRATION_23);
    this.ensureObservationsColumn();
    this.ensureExpiredAtColumn();
  }

  /**
   * Снятое объявление из пула не отдаётся, но и не удаляется: строка с датой
   * смерти — доказательство, что мы его видели и что его больше нет (B200
   * срез 2).
   */
  loadVacancies(): UnifiedVacancy[] {
    const rows = this.database
      .prepare('SELECT payload FROM vacancy_pool WHERE expired_at IS NULL')
      .all() as unknown as VacancyRow[];
    const vacancies: UnifiedVacancy[] = [];
    for (const row of rows) {
      const parsed = parseVacancy(row.payload);
      // A row we cannot read back is not a vacancy we may serve: dropping it
      // keeps the pool honest instead of surfacing a half-decoded card.
      if (parsed) vacancies.push(parsed);
    }
    return vacancies;
  }

  /**
   * Достраивает колонку наблюдений на базе, созданной до B200. `MIGRATION_23`
   * обязан оставаться идемпотентным, а `ADD COLUMN IF NOT EXISTS` в SQLite
   * нет — поэтому наличие колонки проверяется явно.
   */
  private ensureObservationsColumn(): void {
    const columns = this.database
      .prepare('PRAGMA table_info(vacancy_source_state)')
      .all() as unknown as Array<{ name: string }>;
    if (columns.some((column) => column.name === 'observations')) return;
    this.database.exec(VACANCY_SOURCE_OBSERVATIONS_COLUMN);
  }

  /**
   * Достраивает колонку даты смерти на базе, созданной до среза 2 — по той же
   * причине, что и колонку наблюдений: `ADD COLUMN IF NOT EXISTS` в SQLite нет.
   */
  private ensureExpiredAtColumn(): void {
    const columns = this.database
      .prepare('PRAGMA table_info(vacancy_pool)')
      .all() as unknown as Array<{ name: string }>;
    if (columns.some((column) => column.name === 'expired_at')) return;
    this.database.exec(VACANCY_POOL_EXPIRED_AT_COLUMN);
  }

  /**
   * Хоронит объявления, чей адрес сервер объявил несуществующим. Возвращает,
   * сколько записей похоронено этим вызовом: уже похороненное не переписывается
   * — первая дата смерти и есть дата смерти.
   */
  markExpired(vacancyIds: readonly string[], atIso: string): number {
    if (vacancyIds.length === 0) return 0;
    const statement = this.database.prepare(
      'UPDATE vacancy_pool SET expired_at = ? WHERE id = ? AND expired_at IS NULL',
    );
    let buried = 0;
    this.inTransaction(() => {
      for (const id of vacancyIds) {
        buried += Number(statement.run(atIso, id).changes);
      }
    });
    return buried;
  }

  loadSourceStates(): StoredSourceState[] {
    const rows = this.database
      .prepare(
        `SELECT source_id, last_sync_at, last_status, last_error_message,
                items_found_total, items_active_total, observations
           FROM vacancy_source_state`,
      )
      .all() as unknown as SourceStateRow[];
    return rows.map((row) => ({
      sourceId: row.source_id,
      ...(row.last_sync_at ? { lastSyncAt: row.last_sync_at } : {}),
      ...(row.last_status && SOURCE_STATUSES.has(row.last_status)
        ? { lastStatus: row.last_status as StoredSourceState['lastStatus'] }
        : {}),
      ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
      itemsFoundTotal: row.items_found_total,
      itemsActiveTotal: row.items_active_total,
      ...(parseObservations(row.observations) === undefined
        ? {}
        : { observations: parseObservations(row.observations) as SourceObservations }),
    }));
  }

  replaceSourceSlice(sourceId: string, vacancies: UnifiedVacancy[]): void {
    const storedAt = new Date().toISOString();
    // Похороненная запись переживает замену среза: иначе доказательство
    // смерти стиралось бы следующим же опросом площадки (B200 срез 2).
    const remove = this.database.prepare(
      'DELETE FROM vacancy_pool WHERE source_id = ? AND expired_at IS NULL',
    );
    const insert = this.database.prepare(
      `INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         published_at = excluded.published_at,
         stored_at = excluded.stored_at,
         payload = excluded.payload`,
    );
    this.inTransaction(() => {
      remove.run(sourceId);
      for (const vacancy of vacancies) {
        insert.run(
          vacancy.id,
          sourceId,
          vacancy.publishedAt,
          storedAt,
          JSON.stringify(vacancy),
        );
      }
    });
  }

  saveSourceState(state: StoredSourceState): void {
    this.database
      .prepare(
        `INSERT INTO vacancy_source_state (
           source_id, last_sync_at, last_status, last_error_message,
           items_found_total, items_active_total, observations
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           last_sync_at = excluded.last_sync_at,
           last_status = excluded.last_status,
           last_error_message = excluded.last_error_message,
           items_found_total = excluded.items_found_total,
           items_active_total = excluded.items_active_total,
           observations = excluded.observations`,
      )
      .run(
        state.sourceId,
        state.lastSyncAt ?? null,
        state.lastStatus ?? null,
        state.lastErrorMessage ?? null,
        state.itemsFoundTotal,
        state.itemsActiveTotal,
        state.observations ? JSON.stringify(state.observations) : null,
      );
  }

  prune(knownSourceIds: readonly string[], oldestPublishedAt: string): void {
    this.inTransaction(() => {
      this.database
        .prepare('DELETE FROM vacancy_pool WHERE published_at < ?')
        .run(oldestPublishedAt);
      const placeholders = knownSourceIds.map(() => '?').join(', ');
      if (knownSourceIds.length === 0) {
        this.database.exec('DELETE FROM vacancy_pool');
        this.database.exec('DELETE FROM vacancy_source_state');
        return;
      }
      this.database
        .prepare(`DELETE FROM vacancy_pool WHERE source_id NOT IN (${placeholders})`)
        .run(...knownSourceIds);
      this.database
        .prepare(
          `DELETE FROM vacancy_source_state WHERE source_id NOT IN (${placeholders})`,
        )
        .run(...knownSourceIds);
    });
  }

  close(): void {
    this.database.close();
  }

  private inTransaction(operation: () => void): void {
    this.database.exec('BEGIN');
    try {
      operation();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function parseVacancy(payload: string): UnifiedVacancy | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const candidate = parsed as Partial<UnifiedVacancy>;
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.title !== 'string' ||
      typeof candidate.publishedAt !== 'string' ||
      !candidate.provenance ||
      typeof candidate.provenance.sourceId !== 'string'
    ) {
      return undefined;
    }
    return candidate as UnifiedVacancy;
  } catch {
    return undefined;
  }
}
