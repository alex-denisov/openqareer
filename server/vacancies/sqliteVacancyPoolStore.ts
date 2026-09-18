import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import {
  MIGRATION_23,
  VACANCY_CLUSTERS_TABLE,
  VACANCY_POOL_EXPIRED_AT_COLUMN,
  VACANCY_CLUSTER_INPUT_TABLE,
  VACANCY_POOL_INDEX_TABLE,
  VACANCY_SOURCE_OBSERVATIONS_COLUMN,
} from '../data/sqliteSchema';
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
import type { StoredSourceState, VacancyLink, VacancyPoolStore } from './vacancyPoolStore';

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

/** Сколько строк дочитывается из `payload` за один шаг фонового прохода. */
export const BACKFILL_CHUNK = 2_000;

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
export class SqliteVacancyPoolStore implements VacancyPoolStore {
  private readonly database: DatabaseSync;
  /** Докуда дошёл фоновый проход по `rowid`: каждый шаг начинает с него, а не с начала таблицы. */
  private backfillCursor = 0;

  constructor(options: { databasePath: string }) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(MIGRATION_23);
    this.ensureColumn('vacancy_source_state', 'observations', VACANCY_SOURCE_OBSERVATIONS_COLUMN);
    this.ensureColumn('vacancy_pool', 'expired_at', VACANCY_POOL_EXPIRED_AT_COLUMN);
    this.database.exec(VACANCY_POOL_INDEX_TABLE);
    this.database.exec(VACANCY_CLUSTER_INPUT_TABLE);
    this.database.exec(VACANCY_CLUSTERS_TABLE);
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

  private queryTermMatches(
    terms: readonly string[],
    window: FreshnessWindow,
    orderClause: string,
    limit: number,
  ): UnifiedVacancy[] {
    const termClauses = terms.map(() => 'i.search_text LIKE ?').join(' OR ');
    const sql = `SELECT c.cluster_json AS payload
      FROM vacancy_pool_index i
      JOIN vacancy_cluster_input c ON c.id = i.id
      WHERE ${ALIVE} AND i.is_active = 1 AND i.published_ms BETWEEN ? AND ?
        AND (${termClauses})
      ${orderClause} LIMIT ?`;
    const params: SQLInputValue[] = [
      window.fromMs,
      window.toMs,
      ...terms.map((t) => `%${t}%`),
      limit,
    ];
    return this.readVacancies(sql, params);
  }

  private queryRecentFill(
    seenIds: ReadonlySet<string>,
    window: FreshnessWindow,
    orderClause: string,
    limit: number,
  ): UnifiedVacancy[] {
    const notIn =
      seenIds.size > 0 ? `AND i.id NOT IN (${Array.from(seenIds).map(() => '?').join(', ')})` : '';
    const sql = `SELECT c.cluster_json AS payload
      FROM vacancy_pool_index i
      JOIN vacancy_cluster_input c ON c.id = i.id
      WHERE ${ALIVE} AND i.is_active = 1 AND i.published_ms BETWEEN ? AND ? ${notIn}
      ${orderClause} LIMIT ?`;
    const params: SQLInputValue[] = [
      window.fromMs,
      window.toMs,
      ...(seenIds.size > 0 ? Array.from(seenIds) : []),
      limit,
    ];
    return this.readVacancies(sql, params);
  }

  queryMatchCandidates(
    candidate: CandidateMatchProfile,
    options?: MatchCandidateQueryOptions,
  ): UnifiedVacancy[] {
    const limit = options?.limit ?? DEFAULT_MATCH_CANDIDATE_LIMIT;
    if (limit <= 0) return [];
    const window = freshnessWindow(options?.nowMs);
    const preferRemote = Boolean(candidate.preferredRemote);
    const remoteOrder = preferRemote ? '(CASE WHEN i.is_remote = 1 THEN 1 ELSE 0 END) DESC, ' : '';
    const orderClause = `ORDER BY ${remoteOrder}i.published_ms DESC, i.id ASC`;
    const terms = extractMatchTerms(candidate);

    const results: UnifiedVacancy[] = [];
    const seenIds = new Set<string>();

    if (terms.length > 0) {
      for (const item of this.queryTermMatches(terms, window, orderClause, limit)) {
        results.push(item);
        seenIds.add(item.id);
      }
    }

    if (results.length < limit) {
      const remaining = limit - results.length;
      for (const item of this.queryRecentFill(seenIds, window, orderClause, remaining)) {
        if (!seenIds.has(item.id)) {
          results.push(item);
          seenIds.add(item.id);
        }
      }
    }

    return results;
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

  private upsertAll(sourceId: string, vacancies: readonly UnifiedVacancy[]): void {
    const storedAt = new Date().toISOString();
    const insert = this.prepareUpsert();
    const index = this.prepareIndexUpsert();
    const projection = this.prepareProjectionUpsert();
    for (const vacancy of vacancies) {
      insert.run(vacancy.id, sourceId, vacancy.publishedAt, storedAt, JSON.stringify(vacancy));
      index.run(...indexColumns(vacancy, sourceId), 0);
      projection.run(vacancy.id, JSON.stringify(clusterProjectionOf(vacancy)));
    }
  }

  replaceSourceSlice(sourceId: string, vacancies: readonly UnifiedVacancy[]): void {
    // Похороненная запись переживает замену среза: иначе доказательство
    // смерти стиралось бы следующим же опросом площадки (B200 срез 2).
    // Срез снимается по собственным колонкам пула, а не по индексу: строка,
    // ещё не дошедшая до индекса (проход после B221), иначе пережила бы замену.
    const removeIndex = this.database.prepare(
      `DELETE FROM vacancy_pool_index WHERE id IN
         (SELECT id FROM vacancy_pool WHERE source_id = ? AND expired_at IS NULL)`,
    );
    const remove = this.database.prepare(
      'DELETE FROM vacancy_pool WHERE source_id = ? AND expired_at IS NULL',
    );
    const removeProjection = this.database.prepare(
      `DELETE FROM vacancy_cluster_input WHERE id NOT IN (SELECT id FROM vacancy_pool)`,
    );
    this.inTransaction(() => {
      removeIndex.run(sourceId);
      remove.run(sourceId);
      removeProjection.run();
      this.upsertAll(sourceId, vacancies);
    });
  }

  mergeSourceSlice(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
    dropObservedBefore?: string,
  ): void {
    const dropBeforeMs = parseMs(dropObservedBefore);
    this.inTransaction(() => {
      this.upsertAll(sourceId, vacancies);
      if (dropBeforeMs === undefined) return;
      // Полное перечисление, растянутое на тики, закончилось: запись, которую
      // не видел ни один тик с его начала, площадка больше не показывает (B219).
      const gone = `SELECT i.id FROM vacancy_pool_index i WHERE i.source_id = ? AND ${ALIVE}
             AND (i.observed_ms IS NULL OR i.observed_ms < ?)`;
      this.database
        .prepare(`DELETE FROM vacancy_pool WHERE id IN (${gone})`)
        .run(sourceId, dropBeforeMs);
      this.database
        .prepare(`DELETE FROM vacancy_pool_index WHERE id IN (${gone})`)
        .run(sourceId, dropBeforeMs);
      this.database.exec(
        'DELETE FROM vacancy_cluster_input WHERE id NOT IN (SELECT id FROM vacancy_pool_index)',
      );
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
        this.database.exec('DELETE FROM vacancy_pool_index');
        this.database.exec('DELETE FROM vacancy_cluster_input');
        this.database.exec('DELETE FROM vacancy_clusters');
        this.database.exec('DELETE FROM vacancy_source_state');
        return;
      }
      this.database
        .prepare(`DELETE FROM vacancy_pool WHERE source_id NOT IN (${placeholders})`)
        .run(...knownSourceIds);
      // Индекс следует за таблицей: строка без записи — это не запись.
      this.database.exec(
        `DELETE FROM vacancy_pool_index WHERE id NOT IN (SELECT id FROM vacancy_pool)`,
      );
      this.database.exec(
        `DELETE FROM vacancy_cluster_input WHERE id NOT IN (SELECT id FROM vacancy_pool_index)`,
      );
      this.database
        .prepare(`DELETE FROM vacancy_source_state WHERE source_id NOT IN (${placeholders})`)
        .run(...knownSourceIds);
    });
  }

  private prepareClusterUpsert() {
    return this.database.prepare(
      `INSERT INTO vacancy_clusters (
         id, fingerprint, title, company, cluster_json, items_count, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         fingerprint = excluded.fingerprint,
         title = excluded.title,
         company = excluded.company,
         cluster_json = excluded.cluster_json,
         items_count = excluded.items_count,
         updated_at = excluded.updated_at`,
    );
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
        );
      }
    });
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
        }
      }
      for (const cluster of clusters) {
        upsert.run(
          cluster.id,
          cluster.id,
          cluster.canonicalTitle,
          cluster.canonicalCompany,
          JSON.stringify(cluster),
          cluster.vacanciesCount,
          now,
        );
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

  upsertCluster(cluster: VacancyCluster): void {
    const upsert = this.prepareClusterUpsert();
    upsert.run(
      cluster.id,
      cluster.id,
      cluster.canonicalTitle,
      cluster.canonicalCompany,
      JSON.stringify(cluster),
      cluster.vacanciesCount,
      Date.now(),
    );
  }

  deleteCluster(clusterId: string): void {
    this.database.prepare('DELETE FROM vacancy_clusters WHERE id = ?').run(clusterId);
  }

  countClusters(): number {
    const row = this.database
      .prepare('SELECT count(*) AS n FROM vacancy_clusters')
      .get() as { n: number };
    return row.n;
  }

  close(): void {
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
