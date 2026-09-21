/* eslint-disable max-lines -- pool persistence and its bounded public projection
   share one SQLite transaction boundary. */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import {
  MIGRATION_23,
  VACANCY_CLUSTERS_TABLE,
  VACANCY_POOL_EXPIRED_AT_COLUMN,
  VACANCY_CLUSTER_INPUT_TABLE,
  VACANCY_CATALOG_ENTRIES_TABLE,
  VACANCY_CLUSTER_KEYS_TABLE,
  VACANCY_CLUSTER_REPRESENTATIVE_COLUMN,
  VACANCY_POOL_INDEX_TABLE,
  VACANCY_SOURCE_OBSERVATIONS_COLUMN,
  VACANCY_SOURCE_SYNC_REQUESTED_AT_COLUMN,
  VACANCY_SOURCE_SYNC_STARTED_AT_COLUMN,
} from '../data/sqliteSchema';
import { MATCH_ORDER_SCHEMA } from './vacancyMatchIndex';
import { VacancyMatchReader, type MatchRowReader } from './vacancyMatchReader';
import type { SourceObservations } from './sourceHealthVerdict';
import type { CandidateMatchProfile } from './vacancyMatcher';
import {
  clusterProjectionOf,
  DEFAULT_MATCH_CANDIDATE_LIMIT,
  extractMatchTerms,
  freshnessWindow,
  normalizeQuery,
  parseMs,
  searchTextOf,
  type FreshnessWindow,
  type MatchCandidateQueryOptions,
  type VacancyPoolPage,
  type VacancyPoolQuery,
} from './vacancyPoolQuery';
import type {
  MergeSliceResult,
  StoredSourceState,
  VacancyLink,
  VacancyPoolStore,
} from './vacancyPoolStore';
import {
  catalogEntryRowOfCluster,
  type CatalogEntriesPage,
  type CatalogEntriesQuery,
  type CatalogEntryRow,
} from './vacancyCatalogProjection';
import type { CatalogListingSummary } from './vacancyCatalogFacets';
import {
  clusterKeys,
  parseRepresentative,
  serializeRepresentative,
  type ClusterRepresentative,
  type VacancyClusterLookup,
} from './vacancyDeduplicator';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

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
  sync_requested_at: string | null;
  sync_started_at: string | null;
}

interface CatalogEntrySqlRow {
  cluster_id: string;
  entry_key: string;
  path: string;
  title: string;
  company: string;
  location: string | null;
  is_remote: number;
  salary_label: string | null;
  summary: string;
  skills_json: string;
  source_url: string;
  source_name: string | null;
  published_at: string;
  last_seen_at: string;
  source_count: number;
  status: 'active' | 'archived';
  place_slug: string | null;
  place_label: string | null;
  role_slug: string | null;
  role_label: string | null;
  published_ms: number;
  last_seen_ms: number;
}

interface CatalogProjectionStatements {
  readonly upsert: { run(...values: SQLInputValue[]): unknown };
  readonly markSeen: { run(...values: SQLInputValue[]): unknown };
  readonly remove: { run(...values: SQLInputValue[]): unknown };
}

const SOURCE_STATUSES = new Set(['healthy', 'degraded', 'error']);

/** Сколько строк дочитывается из `payload` за один шаг фонового прохода. */
export const BACKFILL_CHUNK = 2_000;
/** Public catalog projection is intentionally smaller than the legacy index pass. */
export const CATALOG_BACKFILL_CHUNK = 100;

/** Дальше этого корзина ключа не считается: сторона и так «большая» (B230). */
const BUCKET_SIZE_CAP = 2_000;

/** Живые строки индекса: похороненная запись из пула не отдаётся (B200 срез 2). */
const ALIVE = 'i.expired = 0';
const FRESH = `${ALIVE} AND i.published_ms BETWEEN ? AND ?`;
/** Запись целиком по живой строке индекса. */
const PAYLOAD_OF = 'SELECT p.payload FROM vacancy_pool_index i JOIN vacancy_pool p ON p.id = i.id';

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

function flag(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

/**
 * Строка индекса записи (B221). Считается один раз при записи — теми же
 * функциями, которыми пул в памяти отвечает на запросы, чтобы обе реализации
 * не разошлись.
 */
function indexColumns(vacancy: UnifiedVacancy, sourceId: string): SQLInputValue[] {
  return [
    vacancy.id,
    sourceId,
    parseMs(vacancy.publishedAt) ?? null,
    parseMs(vacancy.provenance.observedAt) ?? null,
    vacancy.status === 'active' ? 1 : 0,
    flag(vacancy.isRemote),
    typeof vacancy.url === 'string' ? vacancy.url : '',
    searchTextOf(vacancy),
  ];
}

/**
 * The vacancy pool on disk. Opens its own connection to the same file the
 * candidate store uses, the way the auth service does, so the tables are
 * created by the process that actually owns the pool (B164).
 *
 * Since B221 the engine reads the pool from here instead of a copy in the
 * heap: counts, pages and point lookups are SQL, and memory follows the size
 * of a request rather than the size of the pool.
 */
/**
 * Порция записи пула (PRB-043 срез 2). Контракт обслуживателя B230: ни одна
 * транзакция не держит write-lock дольше секунды, иначе HTTP-процесс ждёт
 * его на входе кандидата. Замер на проде 2026-09-21 (`pool-slice-written`,
 * Indeed, 7 292 строки): 250 строк — до 1 196 мс, около 5 мс на строку;
 * локальный бенч давал 0,3 мс и не считается. 100 строк — с запасом вдвое.
 */
export const DEFAULT_POOL_WRITE_CHUNK = 100;

export type PoolWriteEvent =
  | {
      readonly kind: 'transaction';
      readonly operation: 'upsert' | 'remove';
      readonly sourceId: string;
      readonly rows: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'slice';
      readonly operation: 'replace' | 'merge';
      readonly sourceId: string;
      readonly upserted: number;
      readonly removed: number;
      readonly transactions: number;
      readonly maxTransactionMs: number;
      readonly totalMs: number;
    };

export interface SqliteVacancyPoolStoreOptions {
  readonly databasePath: string;
  readonly matchReader?: MatchRowReader;
  /** Строк на одну транзакцию записи среза; по умолчанию `DEFAULT_POOL_WRITE_CHUNK`. */
  readonly writeChunkSize?: number;
  /** Свидетель каждой транзакции записи и итога замены среза — для журнала обслуживателя. */
  readonly onWrite?: (event: PoolWriteEvent) => void;
}

export class SqliteVacancyPoolStore implements VacancyPoolStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  private matchReader?: MatchRowReader;
  private readonly writeChunkSize: number;
  private readonly onWrite?: (event: PoolWriteEvent) => void;
  /** Докуда дошёл фоновый проход по `rowid`: каждый шаг начинает с него, а не с начала таблицы. */
  private backfillCursor = 0;
  /** Докуда дошёл bounded materialized-catalog pass. */
  private catalogBackfillCursor = 0;
  /** Completion is durable and makes later timer ticks pure no-ops. */
  private catalogBackfillComplete = false;
  /** Докуда дошло заполнение `vacancy_cluster_keys` по старым кластерам (B230). */
  private clusterKeysBackfillCursor = 0;
  private clusterKeysBackfillComplete = false;

  constructor(options: SqliteVacancyPoolStoreOptions) {
    this.matchReader = options.matchReader;
    this.writeChunkSize = Math.max(1, Math.floor(options.writeChunkSize ?? DEFAULT_POOL_WRITE_CHUNK));
    this.onWrite = options.onWrite;
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), { recursive: true });
    }
    this.databasePath = options.databasePath;
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(MIGRATION_23);
    this.ensureColumn('vacancy_source_state', 'observations', VACANCY_SOURCE_OBSERVATIONS_COLUMN);
    this.ensureColumn(
      'vacancy_source_state',
      'sync_requested_at',
      VACANCY_SOURCE_SYNC_REQUESTED_AT_COLUMN,
    );
    this.ensureColumn(
      'vacancy_source_state',
      'sync_started_at',
      VACANCY_SOURCE_SYNC_STARTED_AT_COLUMN,
    );
    this.ensureColumn('vacancy_pool', 'expired_at', VACANCY_POOL_EXPIRED_AT_COLUMN);
    this.database.exec(VACANCY_POOL_INDEX_TABLE);
    // Match LIMIT must stop in index order; CASE remote sorting previously
    // joined and sorted the entire fresh pool, including every wide payload.
    this.database.exec(MATCH_ORDER_SCHEMA);
    this.database.exec(VACANCY_CLUSTER_INPUT_TABLE);
    this.database.exec(VACANCY_CLUSTERS_TABLE);
    this.database.exec(VACANCY_CATALOG_ENTRIES_TABLE);
    this.database.exec(VACANCY_CLUSTER_KEYS_TABLE);
    this.ensureColumn('vacancy_clusters', 'representative', VACANCY_CLUSTER_REPRESENTATIVE_COLUMN);
    const keysState = this.database
      .prepare('SELECT cursor_rowid, completed FROM cluster_keys_backfill_state WHERE id = 1')
      .get() as { cursor_rowid: number; completed: number } | undefined;
    this.clusterKeysBackfillComplete = keysState?.completed === 1;
    this.clusterKeysBackfillCursor = keysState?.cursor_rowid ?? 0;
    const projectionState = this.database
      .prepare('SELECT cursor_rowid, completed FROM catalog_projection_state WHERE id = 1')
      .get() as { cursor_rowid: number; completed: number } | undefined;
    this.catalogBackfillComplete = projectionState?.completed === 1;
    this.catalogBackfillCursor = projectionState?.cursor_rowid ?? 0;
  }

  /**
   * Достраивает колонку на базе, созданной раньше неё. `MIGRATION_23` обязан
   * оставаться идемпотентным, а `ADD COLUMN IF NOT EXISTS` в SQLite нет —
   * поэтому наличие колонки проверяется явно.
   */
  private ensureColumn(table: string, column: string, ddl: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{
      name: string;
    }>;
    if (columns.some((existing) => existing.name === column)) return;
    this.database.exec(ddl);
  }

  /**
   * Сколько записей ещё без строки индекса: сделанные до B221. Ноль — база
   * готова отвечать на запросы целиком.
   */
  pendingBackfill(): number {
    const row = this.database
      .prepare(
        `SELECT count(*) AS n FROM vacancy_pool p
          WHERE (NOT EXISTS (SELECT 1 FROM vacancy_pool_index i WHERE i.id = p.id)
               OR NOT EXISTS (SELECT 1 FROM vacancy_cluster_input c WHERE c.id = p.id))`,
      )
      .get() as { n: number };
    return row.n;
  }

  /**
   * Один шаг дочитывания: разбирает `payload` у порции записей без строки
   * индекса и заводит её. Возвращает, сколько строк обработано; ноль — всё
   * готово. Идёт порциями, чтобы вызывающий мог уступать цикл событий между
   * шагами: на проде это 170 000 строк, и целиком они заняли бы окно проверки
   * здоровья.
   */
  backfillStep(chunk: number = BACKFILL_CHUNK): number {
    // Курсор по `rowid`: без него каждый шаг заново перебирал бы уже
    // проиндексированные строки, и проход был бы квадратным.
    const rows = this.database
      .prepare(
        `SELECT p.rowid AS rowid, p.id, p.source_id, p.payload, p.expired_at
           FROM vacancy_pool p
          WHERE p.rowid > ?
            AND (NOT EXISTS (SELECT 1 FROM vacancy_pool_index i WHERE i.id = p.id)
               OR NOT EXISTS (SELECT 1 FROM vacancy_cluster_input c WHERE c.id = p.id))
          ORDER BY p.rowid LIMIT ?`,
      )
      .all(this.backfillCursor, chunk) as unknown as Array<{
      rowid: number;
      id: string;
      source_id: string;
      payload: string;
      expired_at: string | null;
    }>;
    if (rows.length === 0) {
      this.backfillCursor = 0;
      return 0;
    }
    const insert = this.prepareIndexUpsert();
    const projection = this.prepareProjectionUpsert();
    const hasIndexRow = this.database.prepare('SELECT 1 FROM vacancy_pool_index WHERE id = ?');
    const remove = this.database.prepare('DELETE FROM vacancy_pool WHERE id = ?');
    this.inTransaction(() => {
      for (const row of rows) {
        // Строка, которую нельзя прочитать или проиндексировать, вакансией не
        // является — раньше её молча пропускал `restore`, теперь она уходит из
        // базы. Ключ индекса — ключ строки, а не поле из текста: иначе строка,
        // чей текст называет другой идентификатор, оставалась бы без индекса
        // навсегда, и проход не кончался бы.
        const vacancy = parseVacancy(row.payload);
        if (!vacancy) {
          remove.run(row.id);
          continue;
        }
        const projected = { ...vacancy, id: row.id };
        projection.run(row.id, JSON.stringify(clusterProjectionOf(projected)));
        // Строка индекса с выката 1 уже есть: переписывать её целиком (и все
        // её индексы) впятеро дороже, чем добавить одну проекцию.
        if (hasIndexRow.get(row.id) !== undefined) continue;
        // Любая другая ошибка — не повод тихо удалять строку: она всплывает
        // в лог старта, а проход повторится на следующем запуске.
        insert.run(...indexColumns(projected, row.source_id), row.expired_at === null ? 0 : 1);
      }
    });
    this.backfillCursor = rows[rows.length - 1]!.rowid;
    return rows.length;
  }

  private readVacancies(sql: string, params: SQLInputValue[]): UnifiedVacancy[] {
    const statement = this.database.prepare(sql);
    const vacancies: UnifiedVacancy[] = [];
    for (const row of statement.iterate(...params) as IterableIterator<VacancyRow>) {
      const parsed = parseVacancy(row.payload);
      // A row we cannot read back is not a vacancy we may serve: dropping it
      // keeps the pool honest instead of surfacing a half-decoded card.
      if (parsed) vacancies.push(parsed);
    }
    return vacancies;
  }

  loadVacancies(window?: FreshnessWindow): UnifiedVacancy[] {
    return window
      ? this.readVacancies(`${PAYLOAD_OF} WHERE ${FRESH}`, [window.fromMs, window.toMs])
      : this.readVacancies(`${PAYLOAD_OF} WHERE ${ALIVE}`, []);
  }

  /**
   * Вход сведения по одной записи из узкой таблицы индекса — без join с
   * `vacancy_pool` и без полных текстов. Курсор базы остаётся открытым, пока
   * сведение идёт и уступает цикл событий; в куче в каждый момент — одна
   * проекция сверх того, что держит само сведение.
   */
  *iterateClusterInput(window: FreshnessWindow): IterableIterator<UnifiedVacancy> {
    const statement = this.database.prepare(
      `SELECT c.cluster_json AS payload
         FROM vacancy_pool_index i JOIN vacancy_cluster_input c ON c.id = i.id
        WHERE ${FRESH}`,
    );
    for (const row of statement.iterate(
      window.fromMs,
      window.toMs,
    ) as IterableIterator<VacancyRow>) {
      const parsed = parseVacancy(row.payload);
      if (parsed) yield parsed;
    }
  }

  getVacancy(id: string): UnifiedVacancy | undefined {
    return this.readVacancies(`${PAYLOAD_OF} WHERE i.id = ? AND ${ALIVE}`, [id])[0];
  }

  hasVacancy(id: string): boolean {
    return (
      this.database
        .prepare(`SELECT 1 FROM vacancy_pool_index i WHERE i.id = ? AND ${ALIVE}`)
        .get(id) !== undefined
    );
  }

  countVacancies(window: FreshnessWindow): number {
    const row = this.database
      .prepare(`SELECT count(*) AS n FROM vacancy_pool_index i WHERE ${FRESH}`)
      .get(window.fromMs, window.toMs) as { n: number };
    return row.n;
  }

  countBySource(window: FreshnessWindow): ReadonlyMap<string, number> {
    const rows = this.database
      .prepare(
        // Окно свежести обычно накрывает весь пул, а планировщик считает его
        // узким и лезет за каждой строкой: покрывающий индекс называется явно.
        `SELECT i.source_id, count(*) AS n
           FROM vacancy_pool_index i INDEXED BY vacancy_pool_index_source_fresh
          WHERE ${FRESH} GROUP BY i.source_id`,
      )
      .all(window.fromMs, window.toMs) as unknown as Array<{ source_id: string; n: number }>;
    return new Map(rows.map((row) => [row.source_id, row.n]));
  }

  countSourceSlice(sourceId: string): { total: number; active: number } {
    const row = this.database
      .prepare(
        `SELECT count(*) AS total, coalesce(sum(i.is_active), 0) AS active
           FROM vacancy_pool_index i WHERE i.source_id = ? AND ${ALIVE}`,
      )
      .get(sourceId) as { total: number; active: number };
    return { total: row.total, active: row.active };
  }

  countAllSourceSlices(): ReadonlyMap<string, { total: number; active: number }> {
    const rows = this.database
      .prepare(
        `SELECT i.source_id, count(*) AS total, coalesce(sum(i.expired = 0), 0) AS active
           FROM vacancy_pool_index i
          GROUP BY i.source_id
          ORDER BY i.source_id`,
      )
      .all() as unknown as Array<{ source_id: string; total: number; active: number }>;
    return new Map(
      rows.map((row) => [row.source_id, { total: row.total, active: row.active }]),
    );
  }

  queryVacancies(query: VacancyPoolQuery): VacancyPoolPage {
    if (query.sourceIds && query.sourceIds.length === 0) return { total: 0, items: [] };
    const where: string[] = [FRESH];
    const params: SQLInputValue[] = [query.window.fromMs, query.window.toMs];
    if (query.sourceIds) {
      where.push(`i.source_id IN (${query.sourceIds.map(() => '?').join(', ')})`);
      params.push(...query.sourceIds);
    }
    if (query.isRemote !== undefined) {
      where.push('i.is_remote = ?');
      params.push(query.isRemote ? 1 : 0);
    }
    const needle = normalizeQuery(query.query);
    if (needle !== undefined) {
      where.push('instr(i.search_text, ?) > 0');
      params.push(needle);
    }
    const condition = where.join(' AND ');
    const total = (
      this.database
        .prepare(`SELECT count(*) AS n FROM vacancy_pool_index i WHERE ${condition}`)
        .get(...params) as { n: number }
    ).n;
    // Фильтр и порядок — по узкому индексу; тексты читаются только у страницы.
    const items = this.readVacancies(
      `${PAYLOAD_OF} WHERE ${condition}
        ORDER BY i.published_ms DESC, i.id ASC LIMIT ? OFFSET ?`,
      [...params, query.limit, query.offset],
    );
    return { total, items };
  }

  private matchQuery(
    terms: readonly string[],
    seenIds: ReadonlySet<string>,
    window: FreshnessWindow,
    preferRemote: boolean,
    limit: number,
  ): { sql: string; params: SQLInputValue[] } {
    const remote = '(CASE WHEN i.is_remote = 1 THEN 1 ELSE 0 END)';
    const order = `${preferRemote ? `${remote} DESC, ` : ''}i.published_ms DESC, i.id ASC`;
    const termFilter = terms.length
      ? `AND (${terms.map(() => 'i.search_text LIKE ?').join(' OR ')})`
      : '';
    const exclusion = seenIds.size
      ? `AND i.id NOT IN (${[...seenIds].map(() => '?').join(',')})`
      : '';
    const index = preferRemote ? 'vacancy_pool_match_remote' : 'vacancy_pool_match_recent';
    return {
      // Only selected IDs join wide cluster JSON. MATERIALIZED is intentional:
      // SQLite otherwise flattens the subquery back into the unbounded join.
      sql: `WITH selected AS MATERIALIZED (
        SELECT i.id, i.published_ms, ${remote} AS remote_order
        FROM vacancy_pool_index i INDEXED BY ${index}
        WHERE ${ALIVE} AND i.is_active = 1 AND i.published_ms BETWEEN ? AND ?
          ${termFilter} ${exclusion}
        ORDER BY ${order} LIMIT ?
      ) SELECT c.cluster_json AS payload FROM selected s
        JOIN vacancy_cluster_input c ON c.id = s.id
        ORDER BY ${preferRemote ? 's.remote_order DESC, ' : ''}s.published_ms DESC, s.id ASC`,
      params: [window.fromMs, window.toMs, ...terms.map((term) => `%${term}%`), ...seenIds, limit],
    };
  }

  queryMatchCandidates(
    candidate: CandidateMatchProfile,
    options?: MatchCandidateQueryOptions,
  ): UnifiedVacancy[] {
    const limit = options?.limit ?? DEFAULT_MATCH_CANDIDATE_LIMIT;
    if (limit <= 0) return [];
    const window = freshnessWindow(options?.nowMs);
    const preferRemote = Boolean(candidate.preferredRemote);
    const terms = extractMatchTerms(candidate);

    const results: UnifiedVacancy[] = [];
    const seenIds = new Set<string>();

    if (terms.length > 0) {
      const query = this.matchQuery(terms, seenIds, window, preferRemote, limit);
      for (const item of this.readVacancies(query.sql, query.params)) {
        results.push(item);
        seenIds.add(item.id);
      }
    }

    if (results.length < limit) {
      const remaining = limit - results.length;
      const query = this.matchQuery([], seenIds, window, preferRemote, remaining);
      for (const item of this.readVacancies(query.sql, query.params)) {
        if (!seenIds.has(item.id)) {
          results.push(item);
          seenIds.add(item.id);
        }
      }
    }

    return results;
  }

  async queryMatchCandidatesAsync(
    candidate: CandidateMatchProfile,
    options?: MatchCandidateQueryOptions,
  ): Promise<UnifiedVacancy[]> {
    // An in-memory store cannot be reopened by a worker; production is file-backed.
    if (this.databasePath === ':memory:') return this.queryMatchCandidates(candidate, options);
    const limit = options?.limit ?? DEFAULT_MATCH_CANDIDATE_LIMIT;
    if (limit <= 0) return [];
    const window = freshnessWindow(options?.nowMs);
    const preferRemote = Boolean(candidate.preferredRemote);
    const terms = extractMatchTerms(candidate);
    this.matchReader ??= new VacancyMatchReader(this.databasePath);
    const results: UnifiedVacancy[] = [];
    const seenIds = new Set<string>();
    for (const phase of terms.length ? [terms, []] : [[]]) {
      if (results.length >= limit) break;
      const query = this.matchQuery(phase, seenIds, window, preferRemote, limit - results.length);
      const rows = await this.readMatchRows(query, phase.length > 0);
      for (const row of rows) {
        const item = parseVacancy(row.payload);
        if (item && !seenIds.has(item.id)) {
          results.push(item);
          seenIds.add(item.id);
        }
      }
    }
    return results;
  }

  /** Роль, которой нет ни в одной записи, заставляет обойти весь пул — на
   * проде это ~20 с, дольше бюджета читателя. Такой отказ фазы по терминам
   * не отменяет подбор: кандидат получает свежие записи из фазы дополнения,
   * а отказ самой фазы дополнения остаётся отказом чтения. */
  private async readMatchRows(
    query: { sql: string; params: SQLInputValue[] },
    termPhase: boolean,
  ): Promise<{ payload: string }[]> {
    const reader = (this.matchReader ??= new VacancyMatchReader(this.databasePath));
    try {
      return await reader.read(query.sql, query.params);
    } catch (error) {
      if (!termPhase) throw error;
      console.warn(
        JSON.stringify({
          event: 'vacancy-match-term-phase-skipped',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return [];
    }
  }

  loadSourceLinks(sourceId: string): VacancyLink[] {
    return this.database
      .prepare(`SELECT i.id, i.url FROM vacancy_pool_index i WHERE i.source_id = ? AND ${ALIVE}`)
      .all(sourceId) as unknown as VacancyLink[];
  }

  /**
   * Хоронит объявления, чей адрес сервер объявил несуществующим. Возвращает,
   * сколько записей похоронено этим вызовом: уже похороненное не переписывается
   * — первая дата смерти и есть дата смерти.
   */
  markExpired(vacancyIds: readonly string[], atIso: string): number {
    if (vacancyIds.length === 0) return 0;
    const bury = this.database.prepare(
      'UPDATE vacancy_pool SET expired_at = ? WHERE id = ? AND expired_at IS NULL',
    );
    const mark = this.database.prepare(
      'UPDATE vacancy_pool_index SET expired = 1 WHERE id = ? AND expired = 0',
    );
    let buried = 0;
    this.inTransaction(() => {
      for (const id of vacancyIds) {
        buried += Number(bury.run(atIso, id).changes);
        mark.run(id);
      }
    });
    return buried;
  }

  loadSourceStates(): StoredSourceState[] {
    const rows = this.database
      .prepare(
        `SELECT source_id, last_sync_at, last_status, last_error_message,
                items_found_total, items_active_total, observations,
                sync_requested_at, sync_started_at
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
      ...(row.sync_requested_at ? { syncRequestedAt: row.sync_requested_at } : {}),
      ...(row.sync_started_at ? { syncStartedAt: row.sync_started_at } : {}),
      ...(parseObservations(row.observations) === undefined
        ? {}
        : { observations: parseObservations(row.observations) as SourceObservations }),
    }));
  }

  /**
   * Запись обновляется целиком, кроме даты смерти: похороненное объявление,
   * которое площадка показала снова, остаётся похороненным (B200 срез 2).
   */
  private prepareUpsert() {
    return this.database.prepare(
      `INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         published_at = excluded.published_at,
         stored_at = excluded.stored_at,
         payload = excluded.payload`,
    );
  }

  /**
   * Строка индекса при повторе обновляется так же — кроме признака
   * похороненности. Первичная запись берёт его у строки пула: та уже может
   * быть похоронена, но ещё не проиндексирована (проход после B221 идёт).
   */
  private prepareIndexUpsert() {
    return this.database.prepare(
      `INSERT INTO vacancy_pool_index (
         id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, coalesce(
         (SELECT p.expired_at IS NOT NULL FROM vacancy_pool p WHERE p.id = ?1), ?9))
       ON CONFLICT(id) DO UPDATE SET
         source_id = excluded.source_id,
         published_ms = excluded.published_ms,
         observed_ms = excluded.observed_ms,
         is_active = excluded.is_active,
         is_remote = excluded.is_remote,
         url = excluded.url,
         search_text = excluded.search_text`,
    );
  }

  private prepareProjectionUpsert() {
    return this.database.prepare(
      `INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET cluster_json = excluded.cluster_json`,
    );
  }

  /**
   * Пишет срез порциями, каждая — своя транзакция. Одна дата `stored_at` на
   * весь вызов: по ней замена среза потом отличает записи этого чтения от тех,
   * что площадка больше не показывает.
   */
  private upsertAll(sourceId: string, vacancies: readonly UnifiedVacancy[], tally: WriteTally): string {
    const storedAt = new Date().toISOString();
    const insert = this.prepareUpsert();
    const index = this.prepareIndexUpsert();
    const projection = this.prepareProjectionUpsert();
    for (let offset = 0; offset < vacancies.length; offset += this.writeChunkSize) {
      const chunk = vacancies.slice(offset, offset + this.writeChunkSize);
      this.writeTransaction('upsert', sourceId, chunk.length, tally, () => {
        for (const vacancy of chunk) {
          insert.run(vacancy.id, sourceId, vacancy.publishedAt, storedAt, JSON.stringify(vacancy));
          index.run(...indexColumns(vacancy, sourceId), 0);
          projection.run(vacancy.id, JSON.stringify(clusterProjectionOf(vacancy)));
        }
      });
    }
    return storedAt;
  }

  /**
   * Снимает записи по списку id порциями — из проекции, пула и индекса. Срез
   * снимается по собственным колонкам пула, а не по индексу: строка, ещё не
   * дошедшая до индекса (проход после B221), иначе пережила бы замену.
   */
  private removeByIds(sourceId: string, ids: readonly string[], tally: WriteTally): number {
    const removeProjection = this.database.prepare('DELETE FROM vacancy_cluster_input WHERE id = ?');
    const removeIndex = this.database.prepare('DELETE FROM vacancy_pool_index WHERE id = ?');
    const remove = this.database.prepare('DELETE FROM vacancy_pool WHERE id = ?');
    let removed = 0;
    for (let offset = 0; offset < ids.length; offset += this.writeChunkSize) {
      const chunk = ids.slice(offset, offset + this.writeChunkSize);
      this.writeTransaction('remove', sourceId, chunk.length, tally, () => {
        for (const id of chunk) {
          removeProjection.run(id);
          removeIndex.run(id);
          removed += Number(remove.run(id).changes);
        }
      });
    }
    return removed;
  }

  private writeTransaction(
    operation: 'upsert' | 'remove',
    sourceId: string,
    rows: number,
    tally: WriteTally,
    operationBody: () => void,
  ): void {
    const startedAt = performance.now();
    this.inTransaction(operationBody);
    const durationMs = performance.now() - startedAt;
    tally.transactions += 1;
    tally.maxTransactionMs = Math.max(tally.maxTransactionMs, durationMs);
    this.onWrite?.({ kind: 'transaction', operation, sourceId, rows, durationMs });
  }

  /**
   * Замена среза порциями (PRB-043 срез 2). Сначала пишется новое чтение,
   * потом порциями снимается всё живое из этого источника, чего это чтение
   * не касалось — по `stored_at` старше начала вызова. Между порциями пул —
   * надмножество старого и нового, прерванная замена доделывается следующей.
   * Похороненная запись переживает замену: иначе доказательство смерти
   * стиралось бы следующим же опросом площадки (B200 срез 2).
   */
  replaceSourceSlice(sourceId: string, vacancies: readonly UnifiedVacancy[]): void {
    const startedAt = performance.now();
    const tally: WriteTally = { transactions: 0, maxTransactionMs: 0 };
    const storedAt = this.upsertAll(sourceId, vacancies, tally);
    // Курсор по rowid: индекс `vacancy_pool_source` хранит rowid, поэтому срез
    // источника проходится один раз, а не с начала на каждую порцию. Нового
    // индекса не нужно — его создание на 3,8 ГБ прода съело бы окно выката.
    const stale = this.database.prepare(
      `SELECT rowid AS row, id FROM vacancy_pool
        WHERE source_id = ? AND rowid > ? AND expired_at IS NULL AND stored_at < ?
        ORDER BY rowid LIMIT ?`,
    );
    let removed = 0;
    let cursor = 0;
    for (;;) {
      const rows = stale.all(sourceId, cursor, storedAt, this.writeChunkSize) as Array<{
        row: number;
        id: string;
      }>;
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].row;
      removed += this.removeByIds(
        sourceId,
        rows.map((row) => row.id),
        tally,
      );
    }
    this.onWrite?.({
      kind: 'slice',
      operation: 'replace',
      sourceId,
      upserted: vacancies.length,
      removed,
      transactions: tally.transactions,
      maxTransactionMs: tally.maxTransactionMs,
      totalMs: performance.now() - startedAt,
    });
  }

  mergeSourceSlice(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
    dropObservedBefore?: string,
  ): MergeSliceResult {
    const startedAt = performance.now();
    const tally: WriteTally = { transactions: 0, maxTransactionMs: 0 };
    const dropBeforeMs = parseMs(dropObservedBefore);
    this.upsertAll(sourceId, vacancies, tally);
    let dropped: VacancyLink[] = [];
    if (dropBeforeMs !== undefined) {
      // Полное перечисление, растянутое на тики, закончилось: запись, которую
      // не видел ни один тик с его начала, площадка больше не показывает (B219).
      dropped = this.database
        .prepare(
          `SELECT i.id AS id, i.url AS url FROM vacancy_pool_index i
                   WHERE i.source_id = ? AND ${ALIVE}
                     AND (i.observed_ms IS NULL OR i.observed_ms < ?)`,
        )
        .all(sourceId, dropBeforeMs) as unknown as VacancyLink[];
      this.removeByIds(
        sourceId,
        dropped.map((link) => link.id),
        tally,
      );
    }
    this.onWrite?.({
      kind: 'slice',
      operation: 'merge',
      sourceId,
      upserted: vacancies.length,
      removed: dropped.length,
      transactions: tally.transactions,
      maxTransactionMs: tally.maxTransactionMs,
      totalMs: performance.now() - startedAt,
    });
    return { dropped };
  }

  saveSourceState(state: StoredSourceState): void {
    this.database
      .prepare(
        `INSERT INTO vacancy_source_state (
           source_id, last_sync_at, last_status, last_error_message,
           items_found_total, items_active_total, observations,
           sync_requested_at, sync_started_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           last_sync_at = excluded.last_sync_at,
           last_status = excluded.last_status,
           last_error_message = excluded.last_error_message,
           items_found_total = excluded.items_found_total,
           items_active_total = excluded.items_active_total,
           observations = excluded.observations,
           sync_requested_at = CASE
             WHEN vacancy_source_state.sync_requested_at IS NULL
             THEN excluded.sync_requested_at
             WHEN excluded.sync_requested_at IS NULL
             THEN vacancy_source_state.sync_requested_at
             WHEN vacancy_source_state.sync_requested_at >= excluded.sync_requested_at
             THEN vacancy_source_state.sync_requested_at
             ELSE excluded.sync_requested_at
           END,
           sync_started_at = CASE
             WHEN vacancy_source_state.sync_requested_at IS NOT NULL
               AND excluded.sync_requested_at IS NOT NULL
               AND vacancy_source_state.sync_requested_at > excluded.sync_requested_at
             THEN vacancy_source_state.sync_started_at
             WHEN excluded.sync_started_at IS NULL
             THEN vacancy_source_state.sync_started_at
             ELSE excluded.sync_started_at
           END`,
      )
      .run(
        state.sourceId,
        state.lastSyncAt ?? null,
        state.lastStatus ?? null,
        state.lastErrorMessage ?? null,
        state.itemsFoundTotal,
        state.itemsActiveTotal,
        state.observations ? JSON.stringify(state.observations) : null,
        state.syncRequestedAt ?? null,
        state.syncStartedAt ?? null,
      );
  }

  requestSourceSync(sourceId: string, requestedAt: string): void {
    this.database
      .prepare(
        `INSERT INTO vacancy_source_state (
           source_id, items_found_total, items_active_total, sync_requested_at
         ) VALUES (?, 0, 0, ?)
         ON CONFLICT(source_id) DO UPDATE SET
           sync_requested_at = CASE
             WHEN vacancy_source_state.sync_requested_at IS NULL
               OR vacancy_source_state.sync_requested_at < excluded.sync_requested_at
             THEN excluded.sync_requested_at
             ELSE vacancy_source_state.sync_requested_at
           END`,
      )
      .run(sourceId, requestedAt);
  }

  markSourceSyncStarted(sourceId: string, requestedAt: string, startedAt: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE vacancy_source_state
            SET sync_started_at = ?
          WHERE source_id = ? AND sync_requested_at = ?`,
      )
      .run(startedAt, sourceId, requestedAt);
    return Number(result.changes) === 1;
  }

  clearSourceSyncRequest(sourceId: string, requestedAt: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE vacancy_source_state
            SET sync_requested_at = NULL,
                sync_started_at = NULL
          WHERE source_id = ? AND sync_requested_at = ?`,
      )
      .run(sourceId, requestedAt);
    return Number(result.changes) === 1;
  }

  private pruneStaleVacancies(oldestPublishedAt: string): void {
    const oldestMs = Date.parse(oldestPublishedAt);
    if (!Number.isFinite(oldestMs)) return;
    // A full-table DELETE made the first post-deploy restore hold the event
    // loop for minutes on the production pool. Each restart may retire a
    // bounded batch; the indexed pool read remains available throughout.
    this.database
      .prepare(
        `DELETE FROM vacancy_pool
          WHERE id IN (
            SELECT i.id
              FROM vacancy_pool_index i INDEXED BY vacancy_pool_index_fresh
             WHERE i.expired = 0
               AND i.published_ms IS NOT NULL
               AND i.published_ms < ?
             LIMIT 1000
          )`,
      )
      .run(oldestMs);
  }

  private pruneUnknownSources(knownSourceIds: readonly string[]): void {
    const placeholders = knownSourceIds.map(() => '?').join(', ');
    this.database
      .prepare(
        `DELETE FROM vacancy_pool
          WHERE rowid IN (
            SELECT rowid FROM vacancy_pool
             WHERE source_id NOT IN (${placeholders})
             LIMIT 1000
          )`,
      )
      .run(...knownSourceIds);
  }

  private pruneOrphanIndexes(): void {
    // Индекс следует за таблицей: строка без записи — это не запись.
    this.database.exec(`
      DELETE FROM vacancy_pool_index
       WHERE rowid IN (
         SELECT i.rowid FROM vacancy_pool_index i
         LEFT JOIN vacancy_pool p ON p.id = i.id
         WHERE p.id IS NULL LIMIT 1000
       )`);
    this.database.exec(`
      DELETE FROM vacancy_cluster_input
       WHERE rowid IN (
         SELECT c.rowid FROM vacancy_cluster_input c
         LEFT JOIN vacancy_pool_index i ON i.id = c.id
         WHERE i.id IS NULL LIMIT 1000
       )`);
  }

  prune(knownSourceIds: readonly string[], oldestPublishedAt: string): void {
    this.inTransaction(() => {
      this.pruneStaleVacancies(oldestPublishedAt);
      const placeholders = knownSourceIds.map(() => '?').join(', ');
      if (knownSourceIds.length === 0) {
        this.database.exec('DELETE FROM vacancy_pool');
        this.database.exec('DELETE FROM vacancy_pool_index');
        this.database.exec('DELETE FROM vacancy_cluster_input');
        this.database.exec('DELETE FROM vacancy_clusters');
        this.database.exec('DELETE FROM catalog_entries');
        this.database.exec('DELETE FROM catalog_entries_seen');
        this.database.exec(
          `UPDATE catalog_projection_state
              SET cursor_rowid = 0, completed = 1, updated_at = ${Date.now()}
            WHERE id = 1`,
        );
        this.database.exec('DELETE FROM vacancy_source_state');
        return;
      }
      this.pruneUnknownSources(knownSourceIds);
      this.pruneOrphanIndexes();
      this.database
        .prepare(`DELETE FROM vacancy_source_state WHERE source_id NOT IN (${placeholders})`)
        .run(...knownSourceIds);
    });
  }

  private prepareClusterUpsert() {
    return this.database.prepare(
      `INSERT INTO vacancy_clusters (
         id, fingerprint, title, company, cluster_json, items_count, updated_at, representative
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         title = excluded.title,
         company = excluded.company,
         cluster_json = excluded.cluster_json,
         items_count = excluded.items_count,
         updated_at = excluded.updated_at,
         representative = excluded.representative`,
    );
  }

  private prepareCatalogEntryUpsert() {
    return this.database.prepare(
      `INSERT INTO catalog_entries (
         cluster_id, entry_key, path, title, company, location, is_remote,
         salary_label, summary, skills_json, source_url, source_name,
         published_at, last_seen_at, source_count, status,
         place_slug, place_label, role_slug, role_label, published_ms, last_seen_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cluster_id) DO UPDATE SET
         entry_key = excluded.entry_key,
         path = excluded.path,
         title = excluded.title,
         company = excluded.company,
         location = excluded.location,
         is_remote = excluded.is_remote,
         salary_label = excluded.salary_label,
         summary = excluded.summary,
         skills_json = excluded.skills_json,
         source_url = excluded.source_url,
         source_name = excluded.source_name,
         published_at = excluded.published_at,
         last_seen_at = excluded.last_seen_at,
         source_count = excluded.source_count,
         status = excluded.status,
         place_slug = excluded.place_slug,
         place_label = excluded.place_label,
         role_slug = excluded.role_slug,
         role_label = excluded.role_label,
         published_ms = excluded.published_ms,
         last_seen_ms = excluded.last_seen_ms`,
    );
  }

  private markCatalogSeen(
    clusterId: string,
    processedAt = Date.now(),
    statement?: CatalogProjectionStatements['markSeen'],
  ): void {
    const markSeen =
      statement ??
      this.database.prepare(
        `INSERT INTO catalog_entries_seen (cluster_id, processed_at) VALUES (?, ?)
         ON CONFLICT(cluster_id) DO UPDATE SET processed_at = excluded.processed_at`,
      );
    markSeen.run(clusterId, processedAt);
  }

  private writeCatalogEntry(
    cluster: VacancyCluster,
    statements: CatalogProjectionStatements,
  ): void {
    const entry = catalogEntryRowOfCluster(cluster);
    if (!entry) {
      // An unaddressable role is intentionally absent from the public catalog,
      // but still marked as inspected so it cannot hold the backfill open.
      statements.remove.run(cluster.id);
      this.markCatalogSeen(cluster.id, Date.now(), statements.markSeen);
      return;
    }
    const publishedMs = Date.parse(entry.publishedAt);
    const lastSeenMs = Date.parse(entry.lastSeenAt);
    statements.upsert.run(
      entry.clusterId,
      entry.key,
      entry.path,
      entry.title,
      entry.company,
      entry.location ?? null,
      entry.isRemote ? 1 : 0,
      entry.salaryLabel ?? null,
      entry.summary,
      JSON.stringify(entry.skills),
      entry.sourceUrl,
      entry.sourceName ?? null,
      entry.publishedAt,
      entry.lastSeenAt,
      entry.sourceCount,
      entry.status,
      entry.placeSlug ?? null,
      entry.placeLabel ?? null,
      entry.roleSlug ?? null,
      entry.roleLabel ?? null,
      Number.isFinite(publishedMs) ? publishedMs : 0,
      Number.isFinite(lastSeenMs) ? lastSeenMs : 0,
    );
    this.markCatalogSeen(cluster.id, Date.now(), statements.markSeen);
  }

  private upsertCatalogEntry(cluster: VacancyCluster): void {
    this.writeCatalogEntry(cluster, {
      upsert: this.prepareCatalogEntryUpsert(),
      markSeen: this.database.prepare(
        `INSERT INTO catalog_entries_seen (cluster_id, processed_at) VALUES (?, ?)
         ON CONFLICT(cluster_id) DO UPDATE SET processed_at = excluded.processed_at`,
      ),
      remove: this.database.prepare('DELETE FROM catalog_entries WHERE cluster_id = ?'),
    });
  }

  private persistCatalogProjectionBatch(
    rows: ReadonlyArray<{ rowid: number; id: string; cluster_json: string }>,
  ): void {
    const statements: CatalogProjectionStatements = {
      upsert: this.prepareCatalogEntryUpsert(),
      markSeen: this.database.prepare(
        `INSERT INTO catalog_entries_seen (cluster_id, processed_at) VALUES (?, ?)
         ON CONFLICT(cluster_id) DO UPDATE SET processed_at = excluded.processed_at`,
      ),
      remove: this.database.prepare('DELETE FROM catalog_entries WHERE cluster_id = ?'),
    };
    this.inTransaction(() => {
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.cluster_json) as VacancyCluster;
          if (parsed && typeof parsed.id === 'string') {
            this.writeCatalogEntry(parsed, statements);
          } else {
            statements.remove.run(row.id);
            this.markCatalogSeen(row.id, Date.now(), statements.markSeen);
          }
        } catch {
          // A corrupt cluster is not a public entry. Marking its row seen keeps
          // one bad snapshot from preventing the projection from completing.
          statements.remove.run(row.id);
          this.markCatalogSeen(row.id, Date.now(), statements.markSeen);
        }
      }
      this.database
        .prepare(
          `UPDATE catalog_projection_state
              SET cursor_rowid = ?, completed = 0, updated_at = ?
            WHERE id = 1`,
        )
        .run(rows[rows.length - 1]!.rowid, Date.now());
    });
  }

  /** One bounded pass over durable cluster JSON; public reads never call this. */
  backfillCatalogEntriesStep(chunk: number = CATALOG_BACKFILL_CHUNK): number {
    if (this.catalogBackfillComplete) return 0;
    const boundedChunk = Math.max(1, Math.min(Math.trunc(chunk), 1_000));
    // Completion is sticky. Without this guard a timer tick reset the cursor
    // to zero and rewrote the first 500 clusters forever, eventually starving
    // the production HTTP event loop (B229).
    if (this.pendingCatalogEntries() === 0) {
      const maxRow = this.database
        .prepare('SELECT coalesce(max(rowid), 0) AS rowid FROM vacancy_clusters')
        .get() as { rowid: number };
      this.catalogBackfillCursor = maxRow.rowid;
      this.catalogBackfillComplete = true;
      this.database
        .prepare(
          `UPDATE catalog_projection_state
              SET cursor_rowid = ?, completed = 1, updated_at = ?
            WHERE id = 1`,
        )
        .run(maxRow.rowid, Date.now());
      return 0;
    }
    const rows = this.database
      .prepare(
        `SELECT rowid, id, cluster_json
           FROM vacancy_clusters
          WHERE rowid > ?
          ORDER BY rowid ASC
          LIMIT ?`,
      )
      .all(this.catalogBackfillCursor, boundedChunk) as unknown as Array<{
      rowid: number;
      id: string;
      cluster_json: string;
    }>;

    if (rows.length === 0) {
      const maxRow = this.database
        .prepare('SELECT coalesce(max(rowid), 0) AS rowid FROM vacancy_clusters')
        .get() as { rowid: number };
      this.catalogBackfillCursor = maxRow.rowid;
      this.catalogBackfillComplete = true;
      this.database
        .prepare(
          `UPDATE catalog_projection_state
              SET cursor_rowid = ?, completed = 1, updated_at = ?
            WHERE id = 1`,
        )
        .run(maxRow.rowid, Date.now());
      return 0;
    }

    this.persistCatalogProjectionBatch(rows);
    this.catalogBackfillCursor = rows[rows.length - 1]!.rowid;
    return rows.length;
  }

  pendingCatalogEntries(): number {
    const row = this.database
      .prepare(
        `SELECT count(*) AS n
           FROM vacancy_clusters c
           LEFT JOIN catalog_entries_seen s ON s.cluster_id = c.id
          WHERE s.cluster_id IS NULL`,
      )
      .get() as { n: number };
    return row.n;
  }

  catalogProjectionReady(): boolean {
    return this.catalogBackfillComplete || this.pendingCatalogEntries() === 0;
  }

  saveClusters(clusters: VacancyCluster[]): void {
    if (clusters.length === 0) return;
    const upsert = this.prepareClusterUpsert();
    const now = Date.now();
    this.inTransaction(() => {
      for (const cluster of clusters) {
        upsert.run(
          cluster.id,
          cluster.id,
          cluster.canonicalTitle,
          cluster.canonicalCompany,
          JSON.stringify(cluster),
          cluster.vacanciesCount,
          now,
          serializeRepresentative(cluster),
        );
        this.upsertCatalogEntry(cluster);
        this.writeClusterKeys(cluster);
      }
    });
  }

  private prepareClusterKeyStatements() {
    return {
      clear: this.database.prepare('DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?'),
      insert: this.database.prepare(
        'INSERT OR IGNORE INTO vacancy_cluster_keys (kind, key, cluster_id) VALUES (?, ?, ?)',
      ),
    };
  }

  /** Ключи следуют за кластером: каждая запись кластера переписывает их целиком. */
  private writeClusterKeys(
    cluster: VacancyCluster,
    statements = this.prepareClusterKeyStatements(),
  ): void {
    statements.clear.run(cluster.id);
    for (const { kind, key } of clusterKeys(cluster)) statements.insert.run(kind, key, cluster.id);
  }

  private deleteClusterKeys(clusterId: string): void {
    this.database.prepare('DELETE FROM vacancy_cluster_keys WHERE cluster_id = ?').run(clusterId);
  }

  /**
   * Кластеры, которые задели ключи партии (B230): любое прямое совпадение
   * (отпечаток, ссылка, ATS, член) или общий токен работодателя И общий
   * токен названия — ровно то, что `ClusterIndex.candidates` находит в куче.
   * Возвращает в порядке создания, как и индекс: при нескольких кандидатах
   * побеждает старший.
   */
  loadClustersByKeys(lookups: readonly VacancyClusterLookup[]): VacancyCluster[] {
    return this.loadClustersByIds(this.candidateClusterIds(lookups));
  }

  /**
   * Представители кандидатов без чтения JSON: строки ключей, сгруппированные по
   * кластеру. Партия сравнивается с ними, и только совпавший кластер читается
   * целиком (`getCluster`) — куча растёт с числом совпадений, не кандидатов.
   */
  loadClusterRepresentatives(lookups: readonly VacancyClusterLookup[]): ClusterRepresentative[] {
    const ids = this.candidateClusterIds(lookups);
    const found = new Map<string, ClusterRepresentative>();
    const chunk = 500;
    for (let offset = 0; offset < ids.length; offset += chunk) {
      const slice = ids.slice(offset, offset + chunk);
      const marks = slice.map(() => '?').join(', ');
      const rows = this.database
        .prepare(`SELECT id, representative FROM vacancy_clusters WHERE id IN (${marks})`)
        .all(...slice) as unknown as Array<{ id: string; representative: string | null }>;
      for (const row of rows) {
        if (!row.representative) continue;
        const parsed = parseRepresentative(row.id, row.representative);
        if (parsed) found.set(row.id, parsed);
      }
    }
    // Порядок создания, как у индекса в куче: при нескольких кандидатах — старший.
    return ids.filter((id) => found.has(id)).map((id) => found.get(id)!);
  }

  /** Id кластеров-кандидатов в порядке `rowid` — порядке создания. */
  private candidateClusterIds(lookups: readonly VacancyClusterLookup[]): string[] {
    const ids = new Set<string>();
    const bucketSizes = new Map<string, number>();
    const direct = this.database.prepare(
      'SELECT cluster_id FROM vacancy_cluster_keys WHERE kind = ? AND key = ?',
    );
    for (const lookup of lookups) {
      for (const { kind, key } of lookup.direct) {
        for (const row of direct.all(kind, key) as unknown as Array<{ cluster_id: string }>) {
          ids.add(row.cluster_id);
        }
      }
      if (lookup.companyTokens.length === 0 || lookup.titleTokens.length === 0) continue;
      for (const row of this.clustersSharingCompanyAndTitle(lookup, bucketSizes)) {
        ids.add(row.cluster_id);
      }
    }
    return this.orderByCreation(Array.from(ids));
  }

  private orderByCreation(ids: readonly string[]): string[] {
    const ordered: Array<{ rowid: number; id: string }> = [];
    const chunk = 500;
    for (let offset = 0; offset < ids.length; offset += chunk) {
      const slice = ids.slice(offset, offset + chunk);
      const marks = slice.map(() => '?').join(', ');
      const rows = this.database
        .prepare(`SELECT rowid, id FROM vacancy_clusters WHERE id IN (${marks})`)
        .all(...slice) as unknown as Array<{ rowid: number; id: string }>;
      ordered.push(...rows);
    }
    return ordered.sort((a, b) => a.rowid - b.rowid).map((row) => row.id);
  }

  /**
   * «Общий токен работодателя И общий токен названия» — обход со стороны
   * меньшего множества, как в `ClusterIndex.sameCompanyAndTitle`: у крупного
   * работодателя тысячи кластеров, а токен «dev» есть у половины пула.
   * `INTERSECT` считал бы обе стороны целиком на каждую запись.
   */
  private clustersSharingCompanyAndTitle(
    lookup: VacancyClusterLookup,
    bucketSizes: Map<string, number>,
  ): Array<{ cluster_id: string }> {
    const size = (kind: string, keys: readonly string[]): number =>
      keys.reduce((total, key) => total + this.bucketSize(kind, key, bucketSizes), 0);
    const companySide = size('company_token', lookup.companyTokens);
    if (companySide === 0) return [];
    const titleSide = size('title_token', lookup.titleTokens);
    if (titleSide === 0) return [];
    const [outerKind, outerKeys, innerKind, innerKeys] =
      companySide <= titleSide
        ? (['company_token', lookup.companyTokens, 'title_token', lookup.titleTokens] as const)
        : (['title_token', lookup.titleTokens, 'company_token', lookup.companyTokens] as const);
    const outerMarks = outerKeys.map(() => '?').join(', ');
    const innerMarks = innerKeys.map(() => '?').join(', ');
    return this.database
      .prepare(
        `SELECT DISTINCT o.cluster_id AS cluster_id FROM vacancy_cluster_keys o
          WHERE o.kind = ? AND o.key IN (${outerMarks})
            AND EXISTS (
              SELECT 1 FROM vacancy_cluster_keys i
               WHERE i.cluster_id = o.cluster_id AND i.kind = ? AND i.key IN (${innerMarks})
            )`,
      )
      .all(outerKind, ...outerKeys, innerKind, ...innerKeys) as unknown as Array<{
      cluster_id: string;
    }>;
  }

  /**
   * Размер корзины ключа — по индексу, с кэшем на время одной партии и с
   * потолком: чтобы выбрать меньшую сторону, точный счёт корзины «dev» на
   * сотни тысяч записей не нужен.
   */
  private bucketSize(kind: string, key: string, cache: Map<string, number>): number {
    const cacheKey = `${kind}\u0000${key}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const row = this.database
      .prepare(
        `SELECT count(*) AS n FROM (
           SELECT 1 FROM vacancy_cluster_keys WHERE kind = ? AND key = ? LIMIT ${BUCKET_SIZE_CAP}
         )`,
      )
      .get(kind, key) as { n: number };
    cache.set(cacheKey, row.n);
    return row.n;
  }

  private loadClustersByIds(ids: readonly string[]): VacancyCluster[] {
    const clusters: VacancyCluster[] = [];
    const chunk = 500;
    for (let offset = 0; offset < ids.length; offset += chunk) {
      const slice = ids.slice(offset, offset + chunk);
      const marks = slice.map(() => '?').join(', ');
      const rows = this.database
        .prepare(
          `SELECT rowid, cluster_json FROM vacancy_clusters WHERE id IN (${marks}) ORDER BY rowid ASC`,
        )
        .all(...slice) as unknown as Array<{ rowid: number; cluster_json: string }>;
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.cluster_json) as VacancyCluster;
          if (parsed && typeof parsed.id === 'string') clusters.push(parsed);
        } catch {
          // Повреждённая строка — не сосед.
        }
      }
    }
    return clusters;
  }

  /**
   * Один шаг заполнения ключей по кластерам, записанным до B230. Резюмируем и
   * идемпотентен: курсор — `rowid`, шаг — одна транзакция.
   */
  backfillClusterKeysStep(chunk = CATALOG_BACKFILL_CHUNK): number {
    if (this.clusterKeysBackfillComplete) return 0;
    const boundedChunk = Math.max(1, Math.min(Math.trunc(chunk), 1_000));
    const rows = this.database
      .prepare(
        `SELECT rowid, cluster_json FROM vacancy_clusters
          WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`,
      )
      .all(this.clusterKeysBackfillCursor, boundedChunk) as unknown as Array<{
      rowid: number;
      cluster_json: string;
    }>;
    if (rows.length === 0) {
      this.clusterKeysBackfillComplete = true;
      this.database
        .prepare(
          'UPDATE cluster_keys_backfill_state SET completed = 1, updated_at = ? WHERE id = 1',
        )
        .run(Date.now());
      return 0;
    }
    const statements = this.prepareClusterKeyStatements();
    const representative = this.database.prepare(
      'UPDATE vacancy_clusters SET representative = ? WHERE rowid = ?',
    );
    this.inTransaction(() => {
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.cluster_json) as VacancyCluster;
          if (parsed && typeof parsed.id === 'string') {
            this.writeClusterKeys(parsed, statements);
            representative.run(serializeRepresentative(parsed), row.rowid);
          }
        } catch {
          // Повреждённый кластер ключей не получает; проекция каталога его тоже пропускает.
        }
      }
      const last = rows[rows.length - 1]!.rowid;
      this.database
        .prepare(
          'UPDATE cluster_keys_backfill_state SET cursor_rowid = ?, updated_at = ? WHERE id = 1',
        )
        .run(last, Date.now());
      this.clusterKeysBackfillCursor = last;
    });
    return rows.length;
  }

  /** Ключи покрывают все кластеры: сведение по ключам можно включать. */
  clusterKeysReady(): boolean {
    return this.clusterKeysBackfillComplete;
  }

  replaceClusters(clusters: VacancyCluster[]): void {
    const upsert = this.prepareClusterUpsert();
    const now = Date.now();
    const currentIds = new Set(clusters.map((cluster) => cluster.id));
    this.inTransaction(() => {
      const existing = this.database
        .prepare('SELECT id FROM vacancy_clusters')
        .all() as unknown as Array<{ id: string }>;
      for (const row of existing) {
        if (!currentIds.has(row.id)) {
          this.database.prepare('DELETE FROM vacancy_clusters WHERE id = ?').run(row.id);
          this.database.prepare('DELETE FROM catalog_entries WHERE cluster_id = ?').run(row.id);
          this.database
            .prepare('DELETE FROM catalog_entries_seen WHERE cluster_id = ?')
            .run(row.id);
          this.deleteClusterKeys(row.id);
        }
      }
      const keyStatements = this.prepareClusterKeyStatements();
      for (const cluster of clusters) {
        upsert.run(
          cluster.id,
          cluster.id,
          cluster.canonicalTitle,
          cluster.canonicalCompany,
          JSON.stringify(cluster),
          cluster.vacanciesCount,
          now,
          serializeRepresentative(cluster),
        );
        this.upsertCatalogEntry(cluster);
        this.writeClusterKeys(cluster, keyStatements);
      }
    });
  }

  loadClusters(): VacancyCluster[] {
    const rows = this.database
      .prepare('SELECT cluster_json FROM vacancy_clusters ORDER BY updated_at DESC, id ASC')
      .all() as unknown as Array<{ cluster_json: string }>;
    const clusters: VacancyCluster[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.cluster_json) as VacancyCluster;
        if (parsed && typeof parsed.id === 'string') {
          clusters.push(parsed);
        }
      } catch {
        // Пропускаем повреждённую строку
      }
    }
    return clusters;
  }

  loadClustersPage(limit: number, offset = 0): VacancyCluster[] {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 2_000));
    const boundedOffset = Math.max(0, Math.trunc(offset));
    const rows = this.database
      .prepare(
        'SELECT cluster_json FROM vacancy_clusters ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?',
      )
      .all(boundedLimit, boundedOffset) as unknown as Array<{ cluster_json: string }>;
    const clusters: VacancyCluster[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.cluster_json) as VacancyCluster;
        if (parsed && typeof parsed.id === 'string') clusters.push(parsed);
      } catch {
        // Ignore one malformed public row without aborting the whole page.
      }
    }
    return clusters;
  }

  pruneClustersBefore(oldestPublishedAt: string): number {
    const cutoffMs = Date.parse(oldestPublishedAt);
    if (!Number.isFinite(cutoffMs)) return 0;
    // `cluster_json` can be hundreds of thousands of rows. Parsing JSON in a
    // synchronous startup statement blocks Fastify's event loop for minutes.
    // `updated_at` is a cheap numeric snapshot freshness guard; exact
    // lastSeenAt reconciliation belongs to the bounded maintenance pass, never
    // to the readiness path.
    // Keep each startup pass bounded. The next scheduled maintenance pass can
    // continue from the indexed order without turning readiness into a full
    // table operation.
    const result = this.database
      .prepare(
        `DELETE FROM vacancy_clusters
          WHERE rowid IN (
            SELECT rowid FROM vacancy_clusters WHERE updated_at < ? LIMIT 1000
          )`,
      )
      .run(cutoffMs);
    // Ключи без кластера — не соседи; чистятся той же порцией (B230).
    this.database.exec(
      `DELETE FROM vacancy_cluster_keys
        WHERE cluster_id IN (
          SELECT k.cluster_id FROM vacancy_cluster_keys k
          LEFT JOIN vacancy_clusters c ON c.id = k.cluster_id
          WHERE c.id IS NULL LIMIT 1000
        )`,
    );
    return Number(result.changes);
  }

  upsertCluster(cluster: VacancyCluster): void {
    this.inTransaction(() => {
      const upsert = this.prepareClusterUpsert();
      upsert.run(
        cluster.id,
        cluster.id,
        cluster.canonicalTitle,
        cluster.canonicalCompany,
        JSON.stringify(cluster),
        cluster.vacanciesCount,
        Date.now(),
        serializeRepresentative(cluster),
      );
      this.upsertCatalogEntry(cluster);
      this.writeClusterKeys(cluster);
    });
  }

  deleteCluster(clusterId: string): void {
    this.inTransaction(() => {
      this.deleteClusterKeys(clusterId);
      this.database.prepare('DELETE FROM vacancy_clusters WHERE id = ?').run(clusterId);
      this.database.prepare('DELETE FROM catalog_entries WHERE cluster_id = ?').run(clusterId);
      this.database.prepare('DELETE FROM catalog_entries_seen WHERE cluster_id = ?').run(clusterId);
    });
  }

  countClusters(): number {
    const row = this.database.prepare('SELECT count(*) AS n FROM vacancy_clusters').get() as {
      n: number;
    };
    return row.n;
  }

  private catalogEntryFromRow(row: CatalogEntrySqlRow): CatalogEntryRow {
    let skills: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.skills_json);
      if (Array.isArray(parsed))
        skills = parsed.filter((skill): skill is string => typeof skill === 'string');
    } catch {
      // A malformed compact field is an empty list, never a reason to hydrate
      // the source cluster during a public request.
    }
    return {
      clusterId: row.cluster_id,
      key: row.entry_key,
      path: row.path,
      title: row.title,
      company: row.company,
      ...(row.location ? { location: row.location } : {}),
      isRemote: row.is_remote === 1,
      ...(row.salary_label ? { salaryLabel: row.salary_label } : {}),
      summary: row.summary,
      skills,
      sourceUrl: row.source_url,
      ...(row.source_name ? { sourceName: row.source_name } : {}),
      publishedAt: row.published_at,
      lastSeenAt: row.last_seen_at,
      sourceCount: row.source_count,
      status: row.status as CatalogEntryRow['status'],
      ...(row.place_slug ? { placeSlug: row.place_slug } : {}),
      ...(row.place_label ? { placeLabel: row.place_label } : {}),
      ...(row.role_slug ? { roleSlug: row.role_slug } : {}),
      ...(row.role_label ? { roleLabel: row.role_label } : {}),
    };
  }

  loadCatalogEntriesPage(query: CatalogEntriesQuery): CatalogEntriesPage {
    const limit = Math.max(1, Math.min(Math.trunc(query.limit), 50_000));
    const where = ["status = 'active'", "path <> ''"];
    const filterParams: SQLInputValue[] = [];
    if (query.place) {
      where.push('place_slug = ?');
      filterParams.push(query.place);
    }
    if (query.role) {
      where.push('role_slug = ?');
      filterParams.push(query.role);
    }
    const condition = where.join(' AND ');
    const total = (
      this.database
        .prepare(`SELECT count(*) AS n FROM catalog_entries WHERE ${condition}`)
        .get(...filterParams) as { n: number }
    ).n;

    const pageWhere = [...where];
    const pageParams = [...filterParams];
    if (query.after) {
      pageWhere.push('(published_ms < ? OR (published_ms = ? AND entry_key > ?))');
      pageParams.push(query.after.publishedMs, query.after.publishedMs, query.after.key);
    }
    pageParams.push(limit + 1);
    const rows = this.database
      .prepare(
        `SELECT cluster_id, entry_key, path, title, company, location, is_remote,
                salary_label, summary, skills_json, source_url, source_name,
                published_at, last_seen_at, source_count, status,
                place_slug, place_label, role_slug, role_label, published_ms, last_seen_ms
           FROM catalog_entries
          WHERE ${pageWhere.join(' AND ')}
          ORDER BY published_ms DESC, entry_key ASC
          LIMIT ?`,
      )
      .all(...pageParams) as unknown as CatalogEntrySqlRow[];
    const hasNext = rows.length > limit;
    const selected = hasNext ? rows.slice(0, limit) : rows;
    const last = selected.at(-1);
    return {
      items: selected.map((row) => this.catalogEntryFromRow(row)),
      total,
      ...(hasNext && last
        ? { nextCursor: { publishedMs: last.published_ms, key: last.entry_key } }
        : {}),
    };
  }

  loadCatalogListings(): CatalogListingSummary[] {
    const rows = this.database
      .prepare(
        `SELECT place_slug, max(place_label) AS place_label,
                NULL AS role_slug, NULL AS role_label, count(*) AS count
           FROM catalog_entries
          WHERE status = 'active' AND path <> '' AND place_slug IS NOT NULL
          GROUP BY place_slug
         HAVING count(*) >= 3
          UNION ALL
         SELECT place_slug, max(place_label) AS place_label,
                role_slug, max(role_label) AS role_label, count(*) AS count
           FROM catalog_entries
          WHERE status = 'active' AND path <> ''
            AND place_slug IS NOT NULL AND role_slug IS NOT NULL
          GROUP BY place_slug, role_slug
         HAVING count(*) >= 3
          ORDER BY count DESC, place_slug ASC, role_slug ASC`,
      )
      .all() as unknown as Array<{
      place_slug: string;
      place_label: string;
      role_slug: string | null;
      role_label: string | null;
      count: number;
    }>;
    // Importing the path helper here would make the table's SQL shape leak
    // into the route. The values are already validated slugs from the same
    // helper that created the projection, so constructing the route is safe.
    return rows.flatMap((row) => {
      const path = row.role_slug
        ? `/vacancies/${row.place_slug}/${row.role_slug}`
        : `/vacancies/${row.place_slug}`;
      return [
        {
          place: row.place_slug,
          placeLabel: row.place_label,
          ...(row.role_slug
            ? { role: row.role_slug, roleLabel: row.role_label ?? row.role_slug }
            : {}),
          path,
          count: row.count,
        },
      ];
    });
  }

  getCatalogEntry(key: string): CatalogEntryRow | undefined {
    const row = this.database
      .prepare(
        `SELECT cluster_id, entry_key, path, title, company, location, is_remote,
                salary_label, summary, skills_json, source_url, source_name,
                published_at, last_seen_at, source_count, status,
                place_slug, place_label, role_slug, role_label, published_ms, last_seen_ms
           FROM catalog_entries
          WHERE entry_key = ? AND status = 'active' AND path <> ''`,
      )
      .get(key) as CatalogEntrySqlRow | undefined;
    return row ? this.catalogEntryFromRow(row) : undefined;
  }

  getCluster(clusterId: string): VacancyCluster | undefined {
    const row = this.database
      .prepare('SELECT cluster_json FROM vacancy_clusters WHERE id = ?')
      .get(clusterId) as { cluster_json: string } | undefined;
    if (!row) return undefined;
    try {
      const parsed = JSON.parse(row.cluster_json) as VacancyCluster;
      return parsed && typeof parsed.id === 'string' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  close(): void {
    this.matchReader?.close();
    try {
      this.database.close();
    } catch {
      // Идемпотентное закрытие базы
    }
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

interface WriteTally {
  transactions: number;
  maxTransactionMs: number;
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
