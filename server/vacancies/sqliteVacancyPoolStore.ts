import { freshnessAnchorMs, VACANCY_POOL_INDEX_FIRST_SEEN_COLUMN } from './poolLiveness';
/* eslint-disable max-lines -- pool persistence and its bounded public projection
   share one SQLite transaction boundary. */
import { readInWorker } from '../data/readInWorker';
import { PLACEMENT_TABLES } from '../companyDirectory/placement/placementSchema';
import {
  prunePoolInBatches,
  pruneClustersInBatches,
  type PruneLimits,
  type PruneReport,
} from './poolPruneBatches';
import { CATALOG_LISTINGS_TABLE, CATALOG_TOTALS_TABLE } from './catalogTotalsTable';
import { expireClusterSources } from './clusterExpiry';
import { CLUSTER_TEXT_PENDING_TABLE } from './clusterTextPendingTable';
import { HH_TEXT_PRIORITY_MAX_IDS, HH_TEXT_PRIORITY_TABLE } from './hhTextPriorityTable';
import { loadRoleTextPage, type HhRoleTextPage, type HhTextRoleTarget } from './hhTextRolePosition';
import { normalizeSalaryLabel } from './catalogCopy';
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
  MIGRATION_35,
} from '../data/sqliteSchema';
import { MATCH_ORDER_SCHEMA } from './vacancyMatchIndex';
import { VacancyMatchReader, type MatchRowReader } from './vacancyMatchReader';
import { buildSemanticMatchQuery } from './semanticMatchQuery';
import {
  storedHhSampleByRole,
  storedHhSampleByText,
  type StoredHhSampleQuery,
} from './storedHhSampleQuery';
import {
  campaignLevelWindow,
  campaignLevelFloor,
  candidateRoleFunctionCodes,
} from './titleParse/candidateRoleFunctions';
import { LEVEL_RANK } from './levelMatcher';
import { HH_SEARCH_SOURCE_ID } from './hhSearchState';
import { mergeHhVacancySnapshot } from './hhVacancySnapshot';
import { isDetailTextSource } from './detailTextSources';
import { mergeWorkdaySnapshot } from './workdayDescriptions';
import type { SourceObservations } from './sourceHealthVerdict';
import type { CandidateMatchProfile } from './vacancyMatcher';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import {
  clusterProjectionOf,
  DEFAULT_MATCH_CANDIDATE_LIMIT,
  SEMANTIC_MATCH_CANDIDATE_LIMIT,
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
  CatalogChipQuery,
  CatalogTotalsRow,
  MergeSliceResult,
  StoredSourceState,
  VacancyLink,
  VacancyPoolStore,
  ClusterMerge,
} from './vacancyPoolStore';
import {
  catalogEntryRowOfCluster,
  type CatalogEntriesPage,
  type CatalogEntriesQuery,
  type CatalogEntryRow,
} from './vacancyCatalogProjection';
import { roleLabelFromTitle, type CatalogListingSummary } from './vacancyCatalogFacets';
import {
  clusterKeys,
  companyMatchName,
  companyNameTokens,
  parseRepresentative,
  serializeRepresentative,
  type ClusterRepresentative,
  type VacancyClusterLookup,
} from './vacancyDeduplicator';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import type { SalaryStats } from './catalogSalaryStats';
import { readCatalogSalaryStats } from './catalogSalaryStatsStore';
import { readCatalogChipCounts, readCatalogChipKeys } from './catalogChipStore';
import type { ChipCounts } from './catalogChips';
import { extractSkillsFromText } from '../connectors/telegramChannelParser';

const CATALOG_TOTALS_SLICE_ROWS = 20_000;
const CATALOG_ACTIVE_CLUSTERS_SQL = `SELECT coalesce(sum(json_extract(cluster_json, '$.status') = 'active'), 0) AS active FROM vacancy_clusters`;
const CATALOG_LISTINGS_SQL = `SELECT place_slug, max(place_label) AS place_label,
                NULL AS role_slug, NULL AS role_label, NULL AS role_title,
                count(*) AS count
           FROM catalog_entries
          WHERE status = 'active' AND path <> '' AND place_slug IS NOT NULL
          GROUP BY place_slug
         HAVING count(*) >= 3
          UNION ALL
         SELECT place_slug, max(place_label) AS place_label,
                role_slug, max(role_label) AS role_label,
                -- preferredRoleTitle: a Russian title first, then the shortest.
                substr(min(CASE WHEN title GLOB '[А-ЯЁа-яё]*' THEN '0' ELSE '1' END
                           || printf('%05d', length(title)) || title), 7) AS role_title,
                count(*) AS count
           FROM catalog_entries
          WHERE status = 'active' AND path <> ''
            AND place_slug IS NOT NULL AND role_slug IS NOT NULL
          GROUP BY place_slug, role_slug
         HAVING count(*) >= 3
          ORDER BY count DESC, place_slug ASC, role_slug ASC`;
const CATALOG_TOTALS_SLICE_PAUSE_MS = 50;

export interface CatalogTotalsSliceOptions {
  readonly sliceRows?: number;
  readonly pause?: () => Promise<void>;
  readonly computedAt?: string;
}

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

/** 03.11: a sibling process holding an older reading ledger never overwrites a newer one. */
const OBSERVATIONS_NEWER_WINS = `CASE
  WHEN excluded.observations IS NULL THEN vacancy_source_state.observations
  WHEN vacancy_source_state.observations IS NULL THEN excluded.observations
  WHEN coalesce(json_extract(excluded.observations, '$.lastReadingAt'), '')
    >= coalesce(json_extract(vacancy_source_state.observations, '$.lastReadingAt'), '')
  THEN excluded.observations
  ELSE vacancy_source_state.observations
END`;

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
 * B642: запись, которой нет в полном чтении источника, снимается сразу. Каждое
 * такое снятие идёт в журнал со ссылкой, чтобы удаления проверялись выборкой.
 */
function logAbsentRemoved(
  sourceId: string,
  rows: readonly { id: string; url: string | null }[],
): void {
  for (const row of rows) {
    console.info(
      JSON.stringify({ event: 'pool_absent_removed', sourceId, id: row.id, url: row.url ?? '' }),
    );
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
    freshnessAnchorMs(vacancy) ?? null,
    parseMs(vacancy.provenance.observedAt) ?? null,
    vacancy.status === 'active' ? 1 : 0,
    flag(vacancy.isRemote),
    typeof vacancy.url === 'string' ? vacancy.url : '',
    searchTextOf(vacancy),
  ];
}

function semanticDateColumns(vacancy: UnifiedVacancy): SQLInputValue[] {
  return [vacancy.id, freshnessAnchorMs(vacancy) ?? null, flag(vacancy.isRemote)];
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
/**
 * PRB-041 (prod 03.11): a 100-row hh upsert held the write lock 21 s and the web process
 * waited 15 s for it. A transaction commits once it has worked this long, so a web write
 * waits about this much, not a whole chunk.
 */
export const DEFAULT_POOL_WRITE_BUDGET_MS = 100;

export type PoolWriteEvent =
  | {
      readonly kind: 'transaction';
      readonly operation: 'upsert' | 'remove';
      readonly sourceId: string;
      readonly rows: number;
      readonly durationMs: number;
      /** Part of `durationMs` spent waiting for another writer before the work began. */
      readonly lockWaitMs: number;
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
    }
  | ({ readonly kind: 'prune' } & PruneReport);

export interface SqliteVacancyPoolStoreOptions {
  readonly databasePath: string;
  readonly matchReader?: MatchRowReader;
  /** Строк на одну транзакцию записи среза; по умолчанию `DEFAULT_POOL_WRITE_CHUNK`. */
  readonly writeChunkSize?: number;
  /** Работы на одну транзакцию записи среза; по умолчанию `DEFAULT_POOL_WRITE_BUDGET_MS`. */
  readonly writeBudgetMs?: number;
  /** Ожидание между транзакциями записи кластеров; нужно только фоновому писателю. */
  readonly clusterWritePause?: () => void;
  /** Свидетель каждой транзакции записи и итога замены среза — для журнала обслуживателя. */
  readonly onWrite?: (event: PoolWriteEvent) => void;
  /** Подбор по смыслу вместо LIKE по описанию (B267 S3); по умолчанию старое поведение. */
  readonly matchMode?: 'legacy' | 'semantic';
}

interface CatalogListingRow {
  place_slug: string;
  place_label: string;
  role_slug: string | null;
  role_label: string | null;
  role_title: string | null;
  count: number;
}

// Importing the path helper here would make the table's SQL shape leak into
// the route. The values are already validated slugs from the same helper that
// created the projection, so constructing the route is safe.
function listingSummaryOf(row: CatalogListingRow): CatalogListingSummary {
  const path = row.role_slug
    ? `/vacancies/${row.place_slug}/${row.role_slug}`
    : `/vacancies/${row.place_slug}`;
  return {
    place: row.place_slug,
    placeLabel: row.place_label,
    ...(row.role_slug
      ? {
          role: row.role_slug,
          // Rows projected before B535 stored a label rebuilt from the
          // transliterated slug («Programmist 1c»): read it from a title.
          roleLabel: row.role_title
            ? roleLabelFromTitle(row.role_title)
            : (row.role_label ?? row.role_slug),
        }
      : {}),
    path,
    count: row.count,
  };
}

/** Строк индекса за вызов при поиске снятых hh-записей с живым кластером (B641). */
const EXPIRED_HH_CLUSTER_WINDOW = 20_000;

/** B641: the worker polls pending requests every 5 s; a covering partial index skips observations. */
const SOURCE_SYNC_REQUESTED_INDEX = `CREATE INDEX IF NOT EXISTS vacancy_source_state_requested
  ON vacancy_source_state (source_id, sync_requested_at, sync_started_at)
  WHERE sync_requested_at IS NOT NULL`;

export class SqliteVacancyPoolStore implements VacancyPoolStore {
  private readonly database: DatabaseSync;
  private readonly databasePath: string;
  /** Newest `stored_at` this process gave each source (see nextSliceTimestamp). */
  private readonly lastSliceAt = new Map<string, number>();
  private matchReader?: MatchRowReader;
  private readonly hhTextTargetNoted = new Map<string, { key: string; ms: number }>();
  private readonly writeChunkSize: number;
  private readonly writeBudgetMs: number;
  private readonly clusterWritePause: (() => void) | undefined;
  private readonly onWrite?: (event: PoolWriteEvent) => void;
  /** Окно rowid для снятия кластеров со снятых строк hh (B641). */
  private expiredHhClusterCursor = 0;
  readonly matchMode: 'legacy' | 'semantic';
  /** Докуда дошёл фоновый проход по `rowid`: каждый шаг начинает с него, а не с начала таблицы. */
  private backfillCursor = 0;
  /** Докуда дошёл bounded materialized-catalog pass. */
  private catalogBackfillCursor = 0;
  /** Completion is durable and makes later timer ticks pure no-ops. */
  private catalogBackfillComplete = false;
  /** Докуда дошло заполнение `vacancy_cluster_keys` по старым кластерам (B230). */
  private clusterKeysBackfillCursor = 0;
  private clusterKeysBackfillComplete = false;
  /** Раз увидели строку в `vacancy_semantic` — считаем таблицу наполненной насовсем:
   * обслуживатель её не опустошает, а лишний запрос на каждого кандидата не нужен. */
  private semanticTableSeenReady = false;
  /** Докуда дошло обогащение управленческими навыками по описаниям (B307). */
  private descriptionSkillsCursor = 0;
  /** Позиция прохода очистки сирот (B535): сначала кластеры, потом карточки. */
  private orphanCursor: { phase: 'clusters' | 'entries'; rowid: number } = {
    phase: 'clusters',
    rowid: 0,
  };

  constructor(options: SqliteVacancyPoolStoreOptions) {
    this.matchReader = options.matchReader;
    const { writeChunkSize = DEFAULT_POOL_WRITE_CHUNK, writeBudgetMs } = options;
    this.writeChunkSize = Math.max(1, Math.floor(writeChunkSize));
    this.writeBudgetMs = Math.max(0, writeBudgetMs ?? DEFAULT_POOL_WRITE_BUDGET_MS);
    this.clusterWritePause = options.clusterWritePause;
    this.onWrite = options.onWrite;
    this.matchMode = options.matchMode ?? 'legacy';
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
    this.ensurePoolIndex();
    // Match LIMIT must stop in index order; CASE remote sorting previously
    // joined and sorted the entire fresh pool, including every wide payload.
    this.database.exec(MATCH_ORDER_SCHEMA);
    this.database.exec(VACANCY_CLUSTER_INPUT_TABLE);
    this.database.exec(VACANCY_CLUSTERS_TABLE);
    this.database.exec(VACANCY_CATALOG_ENTRIES_TABLE);
    this.database.exec(CATALOG_TOTALS_TABLE + CATALOG_LISTINGS_TABLE);
    this.database.exec(HH_TEXT_PRIORITY_TABLE + CLUSTER_TEXT_PENDING_TABLE);
    this.database.exec(VACANCY_CLUSTER_KEYS_TABLE + PLACEMENT_TABLES);
    // `vacancy_semantic` (B267 S2/S3): тот же файл наполняет обслуживатель,
    // но собственное соединение пула должно видеть таблицу и вне прод-файла
    // (например, `:memory:` в тестах, где второго соединения не будет).
    this.database.exec(MIGRATION_35);
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
  /** Индекс пула и его поздние колонки (B221, B642). */
  private ensurePoolIndex(): void {
    this.database.exec(`${VACANCY_POOL_INDEX_TABLE};${SOURCE_SYNC_REQUESTED_INDEX};`);
    this.ensureColumn('vacancy_pool_index', 'first_seen_ms', VACANCY_POOL_INDEX_FIRST_SEEN_COLUMN);
  }

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

  /** Снятая запись не пропадает — нужна только для ключа `member` (B247 S5). */
  getVacancyIncludingExpired(id: string): UnifiedVacancy | undefined {
    return this.readVacancies(`${PAYLOAD_OF} WHERE i.id = ?`, [id])[0];
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
    return new Map(rows.map((row) => [row.source_id, { total: row.total, active: row.active }]));
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

  private isSemanticTableReady(): boolean {
    if (this.semanticTableSeenReady) return true;
    const row = this.database.prepare('SELECT 1 FROM vacancy_semantic LIMIT 1').get();
    this.semanticTableSeenReady = row !== undefined;
    return this.semanticTableSeenReady;
  }

  /**
   * Единая точка входа режима (B267 S3, план §5): пусто означает legacy —
   * флаг выключен, роли кампании не свелись к известной функции, или
   * `vacancy_semantic` ещё не наполнена обслуживателем (S2 не догнал S3 по
   * времени на этом инстансе).
   */
  resolveSemanticFunctions(candidate: CandidateMatchProfile): FunctionCode[] {
    if (this.matchMode !== 'semantic') return [];
    const codes = candidateRoleFunctionCodes(candidate.targetRoles);
    if (codes.length === 0) return [];
    if (!this.isSemanticTableReady()) {
      console.warn(
        JSON.stringify({
          event: 'vacancy-match-semantic-not-ready',
          candidateId: candidate.candidateId,
        }),
      );
      return [];
    }
    return codes;
  }

  private semanticQuery(
    candidate: CandidateMatchProfile,
    functionCodes: readonly FunctionCode[],
    window: FreshnessWindow,
    preferRemote: boolean,
    limit: number,
  ): { sql: string; params: SQLInputValue[] } {
    const levelFloorRank = campaignLevelFloor(candidate.targetRoles, candidate.targetLevel);
    this.noteHhTextRoleTarget(candidate.candidateId, functionCodes, levelFloorRank ?? null);
    const levelWindow = campaignLevelWindow(candidate.targetRoles, candidate.targetLevel);
    return buildSemanticMatchQuery({
      functionCodes,
      levelRank: candidate.targetLevel ? LEVEL_RANK[candidate.targetLevel] : null,
      levelFloorRank,
      functionLevelFloors: levelWindow.floors,
      functionSpecialistTitles: levelWindow.specialistTitles,
      ...(candidate.matchGeography ? { geography: candidate.matchGeography } : {}),
      ...(candidate.gradeRange ? { gradeRange: candidate.gradeRange } : {}),
      window,
      preferRemote,
      limit,
    });
  }

  queryMatchCandidates(
    candidate: CandidateMatchProfile,
    options?: MatchCandidateQueryOptions,
  ): UnifiedVacancy[] {
    const limit = options?.limit ?? DEFAULT_MATCH_CANDIDATE_LIMIT;
    if (limit <= 0) return [];
    const window = freshnessWindow(options?.nowMs);
    const preferRemote = Boolean(candidate.preferredRemote);

    const semanticFunctions = candidate.semanticRoleFunctions?.length
      ? candidate.semanticRoleFunctions
      : this.resolveSemanticFunctions(candidate);
    if (semanticFunctions.length > 0) {
      const query = this.semanticQuery(candidate, semanticFunctions, window, preferRemote, limit);
      return this.readVacancies(query.sql, query.params);
    }

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
    this.matchReader ??= new VacancyMatchReader(this.databasePath);

    const semanticFunctions = candidate.semanticRoleFunctions?.length
      ? candidate.semanticRoleFunctions
      : this.resolveSemanticFunctions(candidate);
    if (semanticFunctions.length > 0) {
      const semanticLimit = options?.limit ?? SEMANTIC_MATCH_CANDIDATE_LIMIT;
      const query = this.semanticQuery(
        candidate,
        semanticFunctions,
        window,
        preferRemote,
        semanticLimit,
      );
      const rows = await this.readMatchRows(query, false);
      const results: UnifiedVacancy[] = [];
      for (const row of rows) {
        const item = parseVacancy(row.payload);
        if (item) results.push(item);
      }
      return results;
    }

    const terms = extractMatchTerms(candidate);
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

  /**
   * Свежие записи собственного обхода hh для роли — рыночный срез хода
   * консультанта, когда api.hh.ru закрыт для анонимных запросов (29.10):
   * сначала точные совпадения по тексту, остаток — той же функции и близкого
   * уровня (так английская роль находит русские названия hh). Читается тем же
   * дочерним процессом, что и подбор.
   */
  async queryStoredHhSampleAsync(
    text: string,
    limit: number,
    nowMs?: number,
  ): Promise<UnifiedVacancy[]> {
    if (limit <= 0) return [];
    const window = freshnessWindow(nowMs);
    const byText = storedHhSampleByText(text, window, limit);
    const exact = byText ? await this.readStoredSample(byText) : [];
    if (exact.length >= limit) return exact;
    const byRole = storedHhSampleByRole(text, window, limit);
    const similar = byRole ? await this.readStoredSample(byRole) : [];
    const seen = new Set(exact.map((item) => item.id));
    return [...exact, ...similar.filter((item) => !seen.has(item.id))].slice(0, limit);
  }

  private async readStoredSample(query: StoredHhSampleQuery): Promise<UnifiedVacancy[]> {
    if (this.databasePath === ':memory:') return this.readVacancies(query.sql, query.params);
    const reader = (this.matchReader ??= new VacancyMatchReader(this.databasePath));
    const rows = await reader.read(query.sql, query.params);
    return rows.flatMap((row) => parseVacancy(row.payload) ?? []);
  }

  /** Запускает дочерний read-only процесс вне HTTP-обработчика (C44). */
  warmMatchReader(): void {
    if (this.databasePath === ':memory:') return;
    const reader = (this.matchReader ??= new VacancyMatchReader(this.databasePath));
    if (reader instanceof VacancyMatchReader) reader.warm();
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
  loadUnseenLinks(sourceIds: readonly string[], beforeMs: number, limit: number): VacancyLink[] {
    if (sourceIds.length === 0 || limit <= 0) return [];
    return this.database
      .prepare(
        `SELECT i.id, i.url FROM vacancy_pool_index i INDEXED BY vacancy_pool_index_source
          WHERE i.expired = 0 AND i.source_id IN (SELECT value FROM json_each(?)) AND i.observed_ms < ?
          ORDER BY i.observed_ms LIMIT ?`,
      )
      .all(JSON.stringify(sourceIds), beforeMs, limit) as unknown as VacancyLink[];
  }

  markSeen(vacancyIds: readonly string[], nowMs: number): void {
    if (vacancyIds.length === 0) return;
    const index = this.database.prepare(
      `UPDATE vacancy_pool_index SET observed_ms = ?2, published_ms = max(coalesce(published_ms, 0), ?2)
        WHERE id = ?1 AND expired = 0`,
    );
    const semantic = this.database.prepare(
      'UPDATE vacancy_semantic SET published_ms = max(coalesce(published_ms, 0), ?2) WHERE id = ?1',
    );
    this.inTransaction(() => {
      for (const id of vacancyIds) {
        index.run(id, nowMs);
        semantic.run(id, nowMs);
      }
    });
  }

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

  loadRequestedSourceSyncs(): {
    sourceId: string;
    syncRequestedAt: string;
    syncStartedAt?: string;
  }[] {
    const rows = this.database
      .prepare(
        `SELECT source_id, sync_requested_at, sync_started_at
           FROM vacancy_source_state WHERE sync_requested_at IS NOT NULL`,
      )
      .all() as unknown as {
      source_id: string;
      sync_requested_at: string;
      sync_started_at: string | null;
    }[];
    return rows.map((row) => ({
      sourceId: row.source_id,
      syncRequestedAt: row.sync_requested_at,
      ...(row.sync_started_at ? { syncStartedAt: row.sync_started_at } : {}),
    }));
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
         id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired,
         first_seen_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, coalesce(
         (SELECT p.expired_at IS NOT NULL FROM vacancy_pool p WHERE p.id = ?1), ?9), ?4)
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

  /**
   * hh переопубликует вакансию под тем же id: дата индекса пула сдвигается,
   * а строка смыслового индекса хранила дату первой вставки (на проде 01.11
   * так устарели 383 тыс. из 1,05 млн строк). Дата догоняется при записи —
   * по первичному ключу, без прохода по таблице.
   */
  private prepareSemanticDateSync() {
    return this.database.prepare(
      `UPDATE vacancy_semantic SET published_ms = ?2, is_remote = ?3
       WHERE id = ?1 AND (published_ms IS NOT ?2 OR is_remote IS NOT ?3)`,
    );
  }

  private prepareClusterTextPending() {
    return this.database.prepare(
      'INSERT OR IGNORE INTO cluster_text_pending (vacancy_id, requested_ms) VALUES (?, ?)',
    );
  }

  /**
   * Записи, которым сведение должно заново найти двойников по тексту (01.11):
   * сначала очередь дочитанных текстов, потом один проход по старым записям с
   * текстом. Курсор — `rowid`, за вызов просматривается не больше `scan` строк.
   */
  nextClusterTextBatch(limit = 200, scan = 5_000): UnifiedVacancy[] {
    const want = Math.max(1, Math.min(Math.trunc(limit), 1_000));
    const queued = this.database
      .prepare('SELECT vacancy_id AS id FROM cluster_text_pending ORDER BY requested_ms LIMIT ?')
      .all(want) as unknown as Array<{ id: string }>;
    if (queued.length > 0) {
      const remove = this.database.prepare('DELETE FROM cluster_text_pending WHERE vacancy_id = ?');
      this.inTransaction(() => queued.forEach((row) => remove.run(row.id)));
      return queued
        .map((row) => this.getVacancy(row.id))
        .filter((vacancy): vacancy is UnifiedVacancy => vacancy !== undefined);
    }
    const state = this.database
      .prepare('SELECT cursor_rowid, completed FROM cluster_text_backfill_state WHERE id = 1')
      .get() as { cursor_rowid: number; completed: number };
    if (state.completed === 1) return [];
    const rows = this.database
      .prepare(
        `SELECT rowid, payload, expired_at FROM vacancy_pool
          WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      )
      .all(state.cursor_rowid, Math.max(1, Math.trunc(scan))) as unknown as Array<{
      rowid: number;
      payload: string;
      expired_at: string | null;
    }>;
    if (rows.length === 0) {
      this.database
        .prepare('UPDATE cluster_text_backfill_state SET completed = 1 WHERE id = 1')
        .run();
      return [];
    }
    this.database
      .prepare('UPDATE cluster_text_backfill_state SET cursor_rowid = ? WHERE id = 1')
      .run(rows[rows.length - 1]!.rowid);
    const found: UnifiedVacancy[] = [];
    for (const row of rows) {
      if (row.expired_at !== null || !row.payload.includes('"fullDescription"')) continue;
      try {
        const vacancy = JSON.parse(row.payload) as UnifiedVacancy;
        if (vacancy.fullDescription?.trim()) found.push(vacancy);
      } catch {
        // Повреждённая запись двойника не ищет.
      }
    }
    return found;
  }

  private prepareProjectionUpsert() {
    return this.database.prepare(
      `INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET cluster_json = excluded.cluster_json`,
    );
  }

  /** Loads only the HH and Workday records in one write chunk so collection
   * snapshots can preserve loaded descriptions without hydrating the
   * 500k-record slice (detail-text sources since B535). */
  private loadExistingHhVacancies(
    sourceId: string,
    chunk: readonly UnifiedVacancy[],
  ): Map<string, UnifiedVacancy> {
    const existing = new Map<string, UnifiedVacancy>();
    if (!mergesStoredSnapshot(sourceId)) return existing;
    const ids = Array.from(new Set(chunk.map((vacancy) => vacancy.id)));
    const bindLimit = 800;
    for (let offset = 0; offset < ids.length; offset += bindLimit) {
      const selected = ids.slice(offset, offset + bindLimit);
      const placeholders = selected.map(() => '?').join(', ');
      const rows = this.database
        .prepare(
          `SELECT id, payload FROM vacancy_pool
            WHERE source_id = ? AND id IN (${placeholders})
              AND CASE WHEN json_valid(payload) THEN (
                length(trim(coalesce(json_extract(payload, '$.description'), ''))) > 0 OR
                length(trim(coalesce(json_extract(payload, '$.fullDescription'), ''))) > 0 OR
                json_array_length(payload, '$.responsibilities') > 0 OR
                json_array_length(payload, '$.qualifications') > 0
              ) ELSE 0 END`,
        )
        .all(sourceId, ...selected) as Array<{ id: string; payload: string }>;
      for (const row of rows) {
        const parsed = parseVacancy(row.payload);
        if (parsed) existing.set(row.id, parsed);
      }
    }
    return existing;
  }

  /** Byte length of each stored payload, read from the record header (no overflow pages). */
  private storedPayloadBytes(ids: readonly string[]): Map<string, number> {
    const bytes = new Map<string, number>();
    const unique = Array.from(new Set(ids));
    const bindLimit = 800;
    for (let offset = 0; offset < unique.length; offset += bindLimit) {
      const selected = unique.slice(offset, offset + bindLimit);
      const rows = this.database
        .prepare(
          `SELECT id, octet_length(payload) AS bytes FROM vacancy_pool
            WHERE id IN (${selected.map(() => '?').join(', ')})`,
        )
        .all(...selected) as Array<{ id: string; bytes: number }>;
      for (const row of rows) bytes.set(row.id, row.bytes);
    }
    return bytes;
  }

  /**
   * PRB-041: the stored hh snapshots of a chunk are read, parsed and merged
   * before the write lock — inside it they held the lock 11–18 s for one row.
   */
  private prepareUpsertRows(
    sourceId: string,
    chunk: readonly UnifiedVacancy[],
  ): readonly PreparedUpsertRow[] {
    if (!mergesStoredSnapshot(sourceId))
      return mergeUpsertRows(sourceId, chunk, new Map(), new Map());
    const bytes = this.storedPayloadBytes(chunk.map((vacancy) => vacancy.id));
    return mergeUpsertRows(sourceId, chunk, this.loadExistingHhVacancies(sourceId, chunk), bytes);
  }

  /**
   * Inside the transaction: another writer (hh text pass, skills backfill) may
   * have stored text since the read. A changed payload length re-reads the
   * chunk under the lock so the loaded text is merged, not overwritten.
   */
  private refreshChangedRows(
    sourceId: string,
    rows: readonly PreparedUpsertRow[],
  ): readonly PreparedUpsertRow[] {
    if (!mergesStoredSnapshot(sourceId)) return rows;
    const bytes = this.storedPayloadBytes(rows.map((row) => row.vacancy.id));
    if (rows.every((row) => bytes.get(row.vacancy.id) === row.bytes)) return rows;
    const vacancies = rows.map((row) => row.vacancy);
    return mergeUpsertRows(
      sourceId,
      vacancies,
      this.loadExistingHhVacancies(sourceId, vacancies),
      bytes,
    );
  }

  /**
   * Пишет срез порциями, каждая — своя транзакция. Одна дата `stored_at` на
   * весь вызов: по ней замена среза потом отличает записи этого чтения от тех,
   * что площадка больше не показывает.
   */
  private upsertAll(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
    tally: WriteTally,
  ): string {
    const storedAt = this.nextSliceTimestamp(sourceId);
    const statements = this.prepareUpsertStatements();
    for (let offset = 0; offset < vacancies.length; offset += this.writeChunkSize) {
      let pending = this.prepareUpsertRows(
        sourceId,
        vacancies.slice(offset, offset + this.writeChunkSize),
      );
      while (pending.length > 0) {
        const rows = pending;
        pending = pending.slice(
          this.writeTransaction('upsert', sourceId, tally, () =>
            this.upsertRows(sourceId, rows, storedAt, statements),
          ),
        );
      }
    }
    return storedAt;
  }

  /** Async counterpart for the maintenance worker: one event-loop turn per transaction. */
  private async upsertAllAsync(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
    tally: WriteTally,
  ): Promise<string> {
    const storedAt = this.nextSliceTimestamp(sourceId);
    const statements = this.prepareUpsertStatements();
    for (let offset = 0; offset < vacancies.length; offset += this.writeChunkSize) {
      let pending = this.prepareUpsertRows(
        sourceId,
        vacancies.slice(offset, offset + this.writeChunkSize),
      );
      await yieldToEventLoop();
      while (pending.length > 0) {
        const rows = pending;
        pending = pending.slice(
          this.writeTransaction('upsert', sourceId, tally, () =>
            this.upsertRows(sourceId, rows, storedAt, statements),
          ),
        );
        await yieldToEventLoop();
      }
    }
    return storedAt;
  }

  private prepareUpsertStatements() {
    return {
      insert: this.prepareUpsert(),
      index: this.prepareIndexUpsert(),
      semanticDates: this.prepareSemanticDateSync(),
      projection: this.prepareProjectionUpsert(),
      textPending: this.prepareClusterTextPending(),
    };
  }

  /** Writes prepared rows until the transaction spends its budget; returns how many. */
  private upsertRows(
    sourceId: string,
    prepared: readonly PreparedUpsertRow[],
    storedAt: string,
    statements: ReturnType<SqliteVacancyPoolStore['prepareUpsertStatements']>,
  ): number {
    const startedAt = performance.now();
    let written = 0;
    for (const { previous, stored, payload, projection } of this.refreshChangedRows(
      sourceId,
      prepared,
    )) {
      statements.insert.run(stored.id, sourceId, stored.publishedAt, storedAt, payload);
      statements.index.run(...indexColumns(stored, sourceId), 0);
      statements.semanticDates.run(...semanticDateColumns(stored));
      statements.projection.run(stored.id, projection);
      if (gainedFullText(previous, stored)) statements.textPending.run(stored.id, Date.now());
      written += 1;
      if (performance.now() - startedAt >= this.writeBudgetMs) break;
    }
    return written;
  }

  /**
   * `stored_at` distinguishes the current source read from the previous one.
   * Wall-clock milliseconds can repeat on two adjacent ticks, including an
   * empty replacement, which would leave the old row alive because the stale
   * predicate deliberately uses `<` (not `<=`) to protect newly inserted rows.
   *
   * PRB-041: the newest time is kept per source in this process, not read back
   * with MAX(stored_at) — over 664K hh rows that held the HTTP event loop
   * 1.1–1.2 s on every description a matched page loaded (20 s cold). Times
   * come from the same host clock in every process, so the wall clock is
   * already past another process's slice except within the same millisecond.
   */
  private nextSliceTimestamp(sourceId: string): string {
    const previous = this.lastSliceAt.get(sourceId) ?? Number.NEGATIVE_INFINITY;
    const next = Math.max(Date.now(), previous + 1);
    this.lastSliceAt.set(sourceId, next);
    return new Date(next).toISOString();
  }

  /**
   * Снимает записи по списку id порциями — из проекции, пула и индекса. Срез
   * снимается по собственным колонкам пула, а не по индексу: строка, ещё не
   * дошедшая до индекса (проход после B221), иначе пережила бы замену.
   */
  private removeByIds(sourceId: string, ids: readonly string[], tally: WriteTally): number {
    const removeProjection = this.database.prepare(
      'DELETE FROM vacancy_cluster_input WHERE id = ?',
    );
    const removeIndex = this.database.prepare('DELETE FROM vacancy_pool_index WHERE id = ?');
    const remove = this.database.prepare('DELETE FROM vacancy_pool WHERE id = ?');
    let removed = 0;
    for (let offset = 0; offset < ids.length; offset += this.writeChunkSize) {
      const chunk = ids.slice(offset, offset + this.writeChunkSize);
      this.writeTransaction('remove', sourceId, tally, () => {
        for (const id of chunk) {
          removeProjection.run(id);
          removeIndex.run(id);
          removed += Number(remove.run(id).changes);
        }
        return chunk.length;
      });
    }
    return removed;
  }

  private async removeByIdsAsync(
    sourceId: string,
    ids: readonly string[],
    tally: WriteTally,
  ): Promise<number> {
    const removeProjection = this.database.prepare(
      'DELETE FROM vacancy_cluster_input WHERE id = ?',
    );
    const removeIndex = this.database.prepare('DELETE FROM vacancy_pool_index WHERE id = ?');
    const remove = this.database.prepare('DELETE FROM vacancy_pool WHERE id = ?');
    let removed = 0;
    for (let offset = 0; offset < ids.length; offset += this.writeChunkSize) {
      const chunk = ids.slice(offset, offset + this.writeChunkSize);
      this.writeTransaction('remove', sourceId, tally, () => {
        for (const id of chunk) {
          removeProjection.run(id);
          removeIndex.run(id);
          removed += Number(remove.run(id).changes);
        }
        return chunk.length;
      });
      await yieldToEventLoop();
    }
    return removed;
  }

  private writeTransaction(
    operation: 'upsert' | 'remove',
    sourceId: string,
    tally: WriteTally,
    operationBody: () => number,
  ): number {
    const startedAt = performance.now();
    this.database.exec('BEGIN IMMEDIATE');
    const lockWaitMs = performance.now() - startedAt;
    let rows: number;
    try {
      rows = operationBody();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
    const durationMs = performance.now() - startedAt;
    tally.transactions += 1;
    tally.maxTransactionMs = Math.max(tally.maxTransactionMs, durationMs);
    this.onWrite?.({ kind: 'transaction', operation, sourceId, rows, durationMs, lockWaitMs });
    return rows;
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
      `SELECT p.rowid AS row, p.id, i.url FROM vacancy_pool p
         LEFT JOIN vacancy_pool_index i ON i.id = p.id
        WHERE p.source_id = ? AND p.rowid > ? AND p.expired_at IS NULL AND p.stored_at < ?
        ORDER BY p.rowid LIMIT ?`,
    );
    let removed = 0;
    let cursor = 0;
    for (;;) {
      const rows = stale.all(sourceId, cursor, storedAt, this.writeChunkSize) as Array<{
        row: number;
        id: string;
        url: string | null;
      }>;
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].row;
      logAbsentRemoved(sourceId, rows);
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

  async replaceSourceSliceAsync(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
  ): Promise<void> {
    const startedAt = performance.now();
    const tally: WriteTally = { transactions: 0, maxTransactionMs: 0 };
    const storedAt = await this.upsertAllAsync(sourceId, vacancies, tally);
    const stale = this.database.prepare(
      `SELECT p.rowid AS row, p.id, i.url FROM vacancy_pool p
         LEFT JOIN vacancy_pool_index i ON i.id = p.id
        WHERE p.source_id = ? AND p.rowid > ? AND p.expired_at IS NULL AND p.stored_at < ?
        ORDER BY p.rowid LIMIT ?`,
    );
    let removed = 0;
    let cursor = 0;
    for (;;) {
      const rows = stale.all(sourceId, cursor, storedAt, this.writeChunkSize) as Array<{
        row: number;
        id: string;
        url: string | null;
      }>;
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].row;
      logAbsentRemoved(sourceId, rows);
      removed += await this.removeByIdsAsync(
        sourceId,
        rows.map((row) => row.id),
        tally,
      );
      await yieldToEventLoop();
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

  async mergeSourceSliceAsync(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
    dropObservedBefore?: string,
  ): Promise<MergeSliceResult> {
    const startedAt = performance.now();
    const tally: WriteTally = { transactions: 0, maxTransactionMs: 0 };
    const dropBeforeMs = parseMs(dropObservedBefore);
    await this.upsertAllAsync(sourceId, vacancies, tally);
    let dropped: VacancyLink[] = [];
    if (dropBeforeMs !== undefined) {
      dropped = this.database
        .prepare(
          `SELECT i.id AS id, i.url AS url FROM vacancy_pool_index i
                   WHERE i.source_id = ? AND ${ALIVE}
                     AND (i.observed_ms IS NULL OR i.observed_ms < ?)`,
        )
        .all(sourceId, dropBeforeMs) as unknown as VacancyLink[];
      await this.removeByIdsAsync(
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
           observations = ${OBSERVATIONS_NEWER_WINS},
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
    this.stampPlacementHealth(state);
  }

  /** B643-5: здоровье размещения идёт за состоянием площадки, дата полного чтения — только за полным. */
  private stampPlacementHealth(state: StoredSourceState): void {
    const checkedAt = state.lastSyncAt ? Date.parse(state.lastSyncAt) : Number.NaN;
    if (!state.lastStatus || !Number.isFinite(checkedAt)) return;
    this.database
      .prepare(
        `UPDATE company_placement SET health = ?, last_checked_at = ?,
           last_full_read_at = CASE WHEN ? = 1 THEN ? ELSE last_full_read_at END
         WHERE source_id = ?`,
      )
      .run(state.lastStatus, checkedAt, state.fullRead === true ? 1 : 0, checkedAt, state.sourceId);
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

  prune(knownSourceIds: readonly string[], oldestPublishedAt: string): void {
    // Пустой или неполный список значит «источники не загрузились», а не
    // «всё чужое»: чистка неизвестных тогда пропускается (инцидент 12.11).
    const report = prunePoolInBatches(
      this.database,
      knownSourceIds,
      oldestPublishedAt,
      this.pruneLimits(),
    );
    this.onWrite?.({ kind: 'prune', ...report });
  }

  private pruneLimits(): PruneLimits {
    return { chunkRows: this.writeChunkSize, budgetMs: this.writeBudgetMs };
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

  /**
   * The 32-bit `vacancyKey` of two different clusters can collide (03.11 prod:
   * UNIQUE entry_key aborted a whole Indeed write). The first holder keeps the
   * key, the later cluster is simply not addressable, and the write goes on.
   */
  private prepareCatalogEntryUpsert(): CatalogProjectionStatements['upsert'] {
    const holder = this.database.prepare(
      'SELECT cluster_id FROM catalog_entries WHERE entry_key = ? AND cluster_id <> ?',
    );
    const statement = this.prepareCatalogEntryStatement();
    return {
      run: (...values: SQLInputValue[]) => {
        if (holder.get(values[1] as string, values[0] as string)) return undefined;
        return statement.run(...values);
      },
    };
  }

  private prepareCatalogEntryStatement() {
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

  /**
   * Подборка кандидата в голову очереди текста hh (01.11): `rank` — место в подборке.
   * Строка, уже стоящая в очереди, берёт лучшее из мест.
   */
  requestHhTextPriority(
    vacancyIds: readonly string[],
    baseRank = 0,
    nowMs: number = Date.now(),
  ): void {
    const ids = vacancyIds
      .filter((id) => id.startsWith(`${HH_SEARCH_SOURCE_ID}:`))
      .slice(0, HH_TEXT_PRIORITY_MAX_IDS);
    if (ids.length === 0) return;
    const insert = this.database.prepare(
      `INSERT INTO hh_text_priority (vacancy_id, rank, requested_ms) VALUES (?, ?, ?)
       ON CONFLICT(vacancy_id) DO UPDATE SET rank = min(rank, excluded.rank),
         requested_ms = excluded.requested_ms`,
    );
    this.inTransaction(() => ids.forEach((id, index) => insert.run(id, baseRank + index, nowMs)));
  }

  /**
   * Голова очереди подборок: живые hh-записи без текста. Строки, которым текст уже
   * не нужен (дочитан, снят, удалён из пула), уходят из очереди тут же.
   */
  peekHhTextPriority(limit: number): string[] {
    const want = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = this.database
      .prepare(
        `SELECT q.vacancy_id AS id,
                CASE WHEN p.id IS NOT NULL AND ${HH_NEEDS_TEXT} THEN 1 ELSE 0 END AS need
           FROM hh_text_priority q
           LEFT JOIN vacancy_pool p ON p.id = q.vacancy_id
          ORDER BY q.rank ASC, q.requested_ms DESC
          LIMIT ?`,
      )
      .all(want * 4) as Array<{ id: string; need: number }>;
    const done = rows.filter((row) => row.need !== 1).map((row) => row.id);
    if (done.length > 0) this.dropHhTextPriority(done);
    return rows
      .filter((row) => row.need === 1)
      .slice(0, want)
      .map((row) => row.id);
  }

  dropHhTextPriority(vacancyIds: readonly string[]): void {
    const remove = this.database.prepare('DELETE FROM hh_text_priority WHERE vacancy_id = ?');
    for (const id of vacancyIds) remove.run(id);
  }

  /** Позиция обхода текста hh (02.11): воркер перезапускается ~22 раза в сутки и шёл заново. */
  loadHhTextCursor(): string | undefined {
    const row = this.database.prepare('SELECT cursor FROM hh_text_state WHERE id = 1').get() as
      { cursor: string | null } | undefined;
    return row?.cursor ?? undefined;
  }

  saveHhTextCursor(cursor: string | undefined): void {
    this.database
      .prepare(
        `INSERT INTO hh_text_state (id, cursor) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor`,
      )
      .run(cursor ?? null);
  }

  /**
   * Снятая hh-запись снимает и свой кластер (02.11: 75 строк ролей владельца были сняты в
   * пуле, а кластер оставался активным). Источник 13K снятых строк, партия за вызов.
   */
  archiveExpiredHhClusters(limit: number): number {
    // B641 10.11: один запрос по всем 45K снятым строкам hh шёл 5,7 с каждые 12 с и
    // возвращал ноль. Теперь вызов смотрит окно строк индекса по rowid и идёт дальше.
    const from = this.expiredHhClusterCursor;
    const to = from + EXPIRED_HH_CLUSTER_WINDOW;
    const rows = this.database
      .prepare(
        `SELECT c.id AS id FROM vacancy_pool_index i
           JOIN vacancy_clusters c ON c.id = 'cluster-' || i.id
          WHERE i.rowid > ? AND i.rowid <= ?
            AND i.source_id = '${HH_SEARCH_SOURCE_ID}' AND i.expired = 1
            AND coalesce(json_extract(c.cluster_json, '$.status'), 'active') = 'active'
          LIMIT ?`,
      )
      .all(from, to, Math.max(1, Math.trunc(limit))) as Array<{ id: string }>;
    const maxRowid = (
      this.database.prepare('SELECT max(rowid) AS m FROM vacancy_pool_index').get() as {
        m: number | null;
      }
    ).m;
    const full = rows.length >= Math.max(1, Math.trunc(limit));
    // Полная партия: окно проверяется ещё раз. Иначе — следующее окно или начало.
    if (!full) this.expiredHhClusterCursor = maxRowid !== null && to < maxRowid ? to : 0;
    let archived = 0;
    for (const row of rows) {
      const cluster = this.getCluster(row.id);
      if (!cluster) continue;
      const next = expireClusterSources(cluster, new Set([row.id.replace(/^cluster-/u, '')]));
      if (next === cluster) continue;
      this.upsertCluster(next);
      if (next.status === 'archived') archived += 1;
    }
    return archived;
  }

  /** Сколько строк подборок ещё ждут текст: для оценки времени догона. */
  countHhTextPriority(): number {
    const row = this.database.prepare('SELECT count(*) AS n FROM hh_text_priority').get() as {
      n: number;
    };
    return row.n;
  }

  /**
   * Следующие hh-записи без дочитанного текста (B535): сначала карточки
   * публичного каталога, свежие первыми, потом остальной пул. Курсор — позиция
   * в обходе; `undefined` — проход закончен. За вызов просматривается не больше
   * `HH_TEXT_SCAN_LIMIT` строк, чтобы тик не стал полным чтением пула.
   */
  loadHhTextCandidates(cursor: string | undefined, limit: number): HhTextCandidates {
    const want = Math.max(1, Math.min(Math.trunc(limit), 100));
    const ids: string[] = [];
    let scanned = 0;
    let at: HhTextPosition | undefined = parseHhTextCursor(cursor);
    while (at && ids.length < want) {
      if (scanned >= HH_TEXT_SCAN_LIMIT) break;
      const rows = this.hhTextPage(at, HH_TEXT_PAGE);
      if (rows.length === 0) {
        at = nextHhTextPhase(at);
        continue;
      }
      for (const row of rows) {
        scanned += 1;
        at = { phase: at.phase, ms: row.ms, key: row.key };
        if (row.need === 1) ids.push(row.id);
        if (ids.length >= want) break;
      }
    }
    return { ids, ...(at ? { cursor: formatHhTextCursor(at) } : {}) };
  }

  /** Строки ролей активных кампаний: своя позиция, воркер берёт её первой (04.11). */
  loadHhRoleTextCandidates(
    position: string | undefined,
    limit: number,
    nowMs: number = Date.now(),
  ): HhRoleTextPage {
    const targets = this.hhTextRoleTargets(nowMs);
    if (targets.length === 0) return { ids: [], position: position ?? '' };
    return loadRoleTextPage({
      database: this.database,
      sourceId: HH_SEARCH_SOURCE_ID,
      targets,
      position,
      limit: Math.max(1, Math.min(Math.trunc(limit), 100)),
      nowMs,
      needsText: (id) => this.hhNeedsText(id),
    });
  }

  loadHhRoleTextPosition(): string | undefined {
    const row = this.database
      .prepare('SELECT position FROM hh_text_role_position WHERE id = 1')
      .get() as { position: string } | undefined;
    return row?.position;
  }

  saveHhRoleTextPosition(position: string): void {
    this.database
      .prepare(
        `INSERT INTO hh_text_role_position (id, position) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET position = excluded.position`,
      )
      .run(position);
  }

  /**
   * Цель кампании для очереди текста hh: функции и нижняя граница уровня, как у подбора.
   * Пишется, когда подбор кандидата считается; пустые коды цель снимают.
   */
  recordHhTextRoleTarget(
    candidateId: string,
    codes: readonly string[],
    floor: number | null,
    nowMs: number = Date.now(),
  ): void {
    if (codes.length === 0) {
      this.database
        .prepare('DELETE FROM hh_text_role_targets WHERE candidate_id = ?')
        .run(candidateId);
      return;
    }
    this.database
      .prepare(
        `INSERT INTO hh_text_role_targets (candidate_id, function_codes, level_floor, updated_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET function_codes = excluded.function_codes,
           level_floor = excluded.level_floor, updated_ms = excluded.updated_ms`,
      )
      .run(candidateId, JSON.stringify([...codes].sort()), floor, nowMs);
    // Past its term a target no longer steers the queue; the row has no reason to stay.
    this.database
      .prepare('DELETE FROM hh_text_role_targets WHERE updated_ms < ?')
      .run(nowMs - HH_TEXT_TARGET_TTL_MS);
  }

  /** Аккаунт удалён: цель кандидата уходит вместе с ним. */
  forgetHhTextRoleTarget(candidateId: string): void {
    this.recordHhTextRoleTarget(candidateId, [], null);
    this.hhTextTargetNoted.delete(candidateId);
  }

  /** Подбор кандидата считался: его цель ведёт очередь текста hh. Пишет раз в час на цель. */
  private noteHhTextRoleTarget(
    candidateId: string,
    codes: readonly string[],
    floor: number | null,
  ): void {
    const key = `${[...codes].sort().join(',')}|${floor ?? ''}`;
    const last = this.hhTextTargetNoted.get(candidateId);
    const nowMs = Date.now();
    if (last && last.key === key && nowMs - last.ms < HH_TEXT_TARGET_REFRESH_MS) return;
    try {
      this.recordHhTextRoleTarget(candidateId, codes, floor, nowMs);
      this.hhTextTargetNoted.set(candidateId, { key, ms: nowMs });
    } catch (error) {
      // Цель — ускорение очереди текста, не условие подбора: подбор идёт дальше.
      console.warn(
        JSON.stringify({
          event: 'hh-text-role-target-failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }

  private hhTextRoleTargets(nowMs: number = Date.now()): HhTextRoleTarget[] {
    const rows = this.database
      .prepare(
        `SELECT function_codes AS codes, level_floor AS floor FROM hh_text_role_targets
          WHERE updated_ms >= ? ORDER BY updated_ms DESC LIMIT ?`,
      )
      .all(nowMs - HH_TEXT_TARGET_TTL_MS, HH_TEXT_MAX_TARGETS) as Array<{
      codes: string;
      floor: number | null;
    }>;
    return rows.flatMap((row) => {
      try {
        const codes = JSON.parse(row.codes) as unknown;
        if (!Array.isArray(codes) || codes.length === 0) return [];
        return [{ codes: codes.map(String), floor: row.floor }];
      } catch {
        return [];
      }
    });
  }

  private hhNeedsText(id: string): boolean {
    const row = this.database
      .prepare(`SELECT 1 AS need FROM vacancy_pool p WHERE p.id = ? AND ${HH_NEEDS_TEXT}`)
      .get(id);
    return row !== undefined;
  }

  private hhTextPage(
    at: HhTextPosition,
    size: number,
  ): Array<{ id: string; ms: number; key: string; need: number; title?: string }> {
    const needsText = HH_NEEDS_TEXT;
    if (at.phase === 'catalog') {
      return this.database
        .prepare(
          `SELECT substr(c.cluster_id, 9) AS id, c.published_ms AS ms, c.entry_key AS key,
                  CASE WHEN p.id IS NOT NULL AND ${needsText} THEN 1 ELSE 0 END AS need
             FROM catalog_entries c
             LEFT JOIN vacancy_pool p
               ON p.id = substr(c.cluster_id, 9) AND p.source_id = '${HH_SEARCH_SOURCE_ID}'
            WHERE c.status = 'active'
              AND c.cluster_id >= 'cluster-${HH_SEARCH_SOURCE_ID}:'
              AND c.cluster_id < 'cluster-${HH_SEARCH_SOURCE_ID};'
              AND (c.published_ms < ? OR (c.published_ms = ? AND c.entry_key > ?))
            ORDER BY c.published_ms DESC, c.entry_key ASC
            LIMIT ?`,
        )
        .all(at.ms, at.ms, at.key, size) as Array<{
        id: string;
        ms: number;
        key: string;
        need: number;
      }>;
    }
    return this.database
      .prepare(
        `SELECT i.id AS id, i.published_ms AS ms, i.id AS key,
                CASE WHEN c.cluster_id IS NULL AND ${needsText} THEN 1 ELSE 0 END AS need
           FROM vacancy_pool_index i
           JOIN vacancy_pool p ON p.id = i.id
           LEFT JOIN catalog_entries c ON c.cluster_id = 'cluster-' || i.id
          WHERE i.source_id = '${HH_SEARCH_SOURCE_ID}' AND i.expired = 0
            AND (i.published_ms < ? OR (i.published_ms = ? AND i.id > ?))
          ORDER BY i.published_ms DESC, i.id ASC
          LIMIT ?`,
      )
      .all(at.ms, at.ms, at.key, size) as Array<{
      id: string;
      ms: number;
      key: string;
      need: number;
    }>;
  }

  /**
   * Живые записи площадки без дочитанного текста, новые первыми (B535).
   * Точечный запрос по индексу `source_id`: на проде это до ~1 300 строк.
   */
  loadVacanciesWithoutFullText(
    sourceId: string,
    limit: number,
    excludeIds: readonly string[],
  ): UnifiedVacancy[] {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
    const rows = this.database
      .prepare(
        `SELECT id, payload FROM vacancy_pool
          WHERE source_id = ? AND expired_at IS NULL
            AND length(trim(coalesce(json_extract(payload, '$.fullDescription'), ''))) = 0
          ORDER BY rowid DESC
          LIMIT ?`,
      )
      .all(sourceId, boundedLimit + excludeIds.length) as Array<{ id: string; payload: string }>;
    const excluded = new Set(excludeIds);
    return rows
      .filter((row) => !excluded.has(row.id))
      .slice(0, boundedLimit)
      .map((row) => parseVacancy(row.payload))
      .filter((vacancy): vacancy is UnifiedVacancy => vacancy !== undefined);
  }

  /**
   * Один шаг обогащения вакансий с описанием, но без ключевых навыков (B307).
   * Идёт пачками по `rowid`, не перегружая память и уступая цикл событий.
   */
  backfillDescriptionSkillsStep(chunk = 100): {
    inspected: number;
    updated: number;
    passFinished: boolean;
  } {
    const boundedChunk = Math.max(1, Math.min(Math.trunc(chunk), 1_000));
    const rows = this.database
      .prepare(
        `SELECT rowid, id, source_id, payload, expired_at
           FROM vacancy_pool
          WHERE rowid > ?
          ORDER BY rowid ASC
          LIMIT ?`,
      )
      .all(this.descriptionSkillsCursor, boundedChunk) as unknown as Array<{
      rowid: number;
      id: string;
      source_id: string;
      payload: string;
      expired_at: string | null;
    }>;

    if (rows.length === 0) {
      this.descriptionSkillsCursor = 0;
      return { inspected: 0, updated: 0, passFinished: true };
    }

    this.descriptionSkillsCursor = rows[rows.length - 1]!.rowid;
    const toUpdate = this.collectDescriptionSkillsUpdates(rows);
    this.applyDescriptionSkillsUpdates(toUpdate);

    return {
      inspected: rows.length,
      updated: toUpdate.length,
      passFinished: false,
    };
  }

  private collectDescriptionSkillsUpdates(
    rows: ReadonlyArray<{
      id: string;
      source_id: string;
      payload: string;
      expired_at: string | null;
    }>,
  ): Array<{ vacancy: UnifiedVacancy; sourceId: string; isExpired: boolean }> {
    const toUpdate: Array<{ vacancy: UnifiedVacancy; sourceId: string; isExpired: boolean }> = [];
    for (const row of rows) {
      const vacancy = parseVacancy(row.payload);
      if (!vacancy) continue;
      const desc = vacancy.fullDescription ?? vacancy.description;
      if (desc && (vacancy.requiredSkills?.length ?? 0) === 0) {
        const newSkills = extractSkillsFromText(desc);
        if (newSkills.length > 0) {
          toUpdate.push({
            vacancy: { ...vacancy, requiredSkills: newSkills },
            sourceId: row.source_id,
            isExpired: row.expired_at !== null,
          });
        }
      }
    }
    return toUpdate;
  }

  private applyDescriptionSkillsUpdates(
    toUpdate: ReadonlyArray<{ vacancy: UnifiedVacancy; sourceId: string; isExpired: boolean }>,
  ): void {
    if (toUpdate.length === 0) return;
    const updatePool = this.database.prepare('UPDATE vacancy_pool SET payload = ? WHERE id = ?');
    const index = this.prepareIndexUpsert();
    const projection = this.prepareProjectionUpsert();

    this.inTransaction(() => {
      for (const item of toUpdate) {
        updatePool.run(JSON.stringify(item.vacancy), item.vacancy.id);
        index.run(...indexColumns(item.vacancy, item.sourceId), item.isExpired ? 1 : 0);
        projection.run(item.vacancy.id, JSON.stringify(clusterProjectionOf(item.vacancy)));
      }
    });
  }

  saveClusters(clusters: VacancyCluster[]): void {
    if (clusters.length === 0) return;
    const writeCluster = this.clusterWriter();
    this.writeInPortions(clusters, writeCluster);
  }

  /** Поглотивший кластер и удаление поглощённых идут одной транзакцией: читатель не видит запись дважды. */
  mergeClusters(merges: readonly ClusterMerge[]): void {
    if (merges.length === 0) return;
    // Слияния идут сразу за записью партии: зазор нужен и между этими двумя вызовами.
    this.clusterWritePause?.();
    const writeCluster = this.clusterWriter();
    this.writeInPortions(merges, ({ kept, goneIds }) => {
      writeCluster(kept);
      for (const id of goneIds) this.deleteClusterRows(id);
    });
  }

  /** Строка кластера, его запись в каталоге и ключи: неделимая единица записи. */
  private clusterWriter(): (cluster: VacancyCluster) => void {
    const upsert = this.prepareClusterUpsert();
    const now = Date.now();
    return (cluster) => {
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
    };
  }

  /**
   * Транзакция закрывается по бюджету времени (PRB-041): запись 7–17 тыс. строк
   * держала блокировку 1–3,4 с и останавливала чтения HTTP. Запись остаётся
   * синхронной: партия от чтения до записи занимает один такт и не пересекается
   * с другими писателями этого процесса. Короткие транзакции подряд соседа не
   * пропускают: busy_timeout опрашивает блокировку редко, поэтому между ними пауза.
   *
   * Деление безопасно, пока запись не переходит из кластера в кластер иначе как
   * через `mergeClusters`: сведение по ключам ищет сперва по членству, поэтому
   * другого перехода нет. Элемент не делится, так что тяжёлый кластер один может
   * превысить бюджет.
   */
  private writeInPortions<T>(items: readonly T[], write: (item: T) => void): void {
    let position = 0;
    while (position < items.length) {
      if (position > 0) this.clusterWritePause?.();
      this.inTransaction(() => {
        const startedAt = performance.now();
        do {
          write(items[position]!);
          position += 1;
        } while (position < items.length && performance.now() - startedAt < this.writeBudgetMs);
      });
    }
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

  /**
   * Действующие кластеры одного работодателя для экрана компании: токены
   * `company_token` по индексу, затем точное имя без юридической формы по
   * колонке `company` — JSON читается только у совпавших, не больше `limit`.
   */
  loadClustersByCompany(companyName: string, limit: number): VacancyCluster[] {
    const tokens = companyNameTokens(companyName);
    const wanted = companyMatchName(companyName);
    if (tokens.length === 0 || !wanted || limit <= 0) return [];
    const marks = tokens.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT c.id AS id, c.company AS company FROM vacancy_clusters c
          WHERE c.id IN (
            SELECT cluster_id FROM vacancy_cluster_keys
             WHERE kind = 'company_token' AND key IN (${marks})
             GROUP BY cluster_id HAVING COUNT(DISTINCT key) = ?
          )
          ORDER BY c.updated_at DESC`,
      )
      .all(...tokens, tokens.length) as unknown as Array<{ id: string; company: string }>;
    const ids = rows
      .filter((row) => companyMatchName(row.company ?? '') === wanted)
      .map((row) => row.id);
    const found: VacancyCluster[] = [];
    for (let offset = 0; offset < ids.length && found.length < limit; offset += limit) {
      for (const item of this.loadClustersByIds(ids.slice(offset, offset + limit))) {
        if (item.status === 'active' && found.length < limit) found.push(item);
      }
    }
    return found;
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

  /**
   * Один шаг очистки сирот (B535). Пул чистится по возрасту и заменой среза,
   * а кластер и его карточка каталога оставались: карточка показывала вакансию,
   * которой у нас уже нет, и попадала в sitemap. Кластер удаляется, когда ни
   * одного его члена (`sourceId:externalId`, `sourceId:sourceUrl` или id
   * основателя) нет в индексе пула; похороненная запись — ещё запись. Потом
   * тот же проход снимает карточки, у которых кластера нет вовсе.
   */
  removeOrphanClustersStep(chunk = 500): {
    inspected: number;
    removed: number;
    passFinished: boolean;
  } {
    const size = Math.max(1, Math.min(Math.trunc(chunk), 2_000));
    if (this.orphanCursor.phase === 'clusters') {
      const step = this.removeOrphanClustersPage(size);
      if (step) return step;
      this.orphanCursor = { phase: 'entries', rowid: 0 };
    }
    return this.removeOrphanEntriesPage(size);
  }

  private removeOrphanClustersPage(
    size: number,
  ): { inspected: number; removed: number; passFinished: boolean } | undefined {
    const rows = this.database
      .prepare(
        'SELECT rowid, id, cluster_json FROM vacancy_clusters WHERE rowid > ? ORDER BY rowid LIMIT ?',
      )
      .all(this.orphanCursor.rowid, size) as Array<{
      rowid: number;
      id: string;
      cluster_json: string;
    }>;
    if (rows.length === 0) return undefined;
    this.orphanCursor = { phase: 'clusters', rowid: rows[rows.length - 1]!.rowid };
    const present = this.database.prepare('SELECT 1 FROM vacancy_pool_index WHERE id = ?');
    const orphans = rows
      .filter((row) => {
        const ids = clusterMemberIds(row.id, row.cluster_json);
        return ids !== null && !ids.some((id) => present.get(id));
      })
      .map((row) => row.id);
    this.deleteClustersRows(orphans);
    return { inspected: rows.length, removed: orphans.length, passFinished: false };
  }

  private removeOrphanEntriesPage(size: number): {
    inspected: number;
    removed: number;
    passFinished: boolean;
  } {
    const entries = this.database
      .prepare(
        `SELECT e.rowid AS rowid, e.cluster_id AS id, c.id IS NULL AS orphan
           FROM catalog_entries e LEFT JOIN vacancy_clusters c ON c.id = e.cluster_id
          WHERE e.rowid > ? ORDER BY e.rowid LIMIT ?`,
      )
      .all(this.orphanCursor.rowid, size) as Array<{ rowid: number; id: string; orphan: number }>;
    if (entries.length === 0) {
      this.orphanCursor = { phase: 'clusters', rowid: 0 };
      return { inspected: 0, removed: 0, passFinished: true };
    }
    this.orphanCursor = { phase: 'entries', rowid: entries[entries.length - 1]!.rowid };
    const orphans = entries.filter((entry) => entry.orphan === 1).map((entry) => entry.id);
    this.deleteClustersRows(orphans);
    return { inspected: entries.length, removed: orphans.length, passFinished: false };
  }

  private deleteClustersRows(clusterIds: readonly string[]): void {
    if (clusterIds.length === 0) return;
    this.inTransaction(() => {
      for (const id of clusterIds) this.deleteClusterRows(id);
    });
  }

  private deleteClusterRows(clusterId: string): void {
    this.deleteClusterKeys(clusterId);
    this.database.prepare('DELETE FROM vacancy_clusters WHERE id = ?').run(clusterId);
    this.database.prepare('DELETE FROM catalog_entries WHERE cluster_id = ?').run(clusterId);
    this.database.prepare('DELETE FROM catalog_entries_seen WHERE cluster_id = ?').run(clusterId);
  }

  pruneClustersBefore(oldestPublishedAt: string): number {
    const cutoffMs = Date.parse(oldestPublishedAt);
    if (!Number.isFinite(cutoffMs)) return 0;
    // `cluster_json` can be hundreds of thousands of rows. Parsing JSON in a
    // synchronous startup statement blocks Fastify's event loop for minutes.
    // `updated_at` is a cheap numeric snapshot freshness guard; exact
    // lastSeenAt reconciliation belongs to the bounded maintenance pass, never
    // to the readiness path.
    const { clusters, report } = pruneClustersInBatches(
      this.database,
      cutoffMs,
      this.pruneLimits(),
    );
    this.onWrite?.({ kind: 'prune', ...report });
    return clusters;
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
    this.inTransaction(() => this.deleteClusterRows(clusterId));
  }

  countClusters(): number {
    const row = this.database.prepare('SELECT count(*) AS n FROM vacancy_clusters').get() as {
      n: number;
    };
    return row.n;
  }

  /**
   * B485: только процесс обслуживания. Активность кластера хранится лишь в его
   * JSON, поэтому полный проход — здесь, вне HTTP, не чаще раза в 15 минут.
   */
  recomputeCatalogTotals(
    observedAt: string,
    computedAt = new Date().toISOString(),
  ): CatalogTotalsRow {
    const row = this.database
      .prepare(
        `SELECT count(*) AS n FROM vacancy_clusters
          WHERE json_extract(cluster_json, '$.status') = 'active'`,
      )
      .get() as { n: number };
    return this.writeCatalogTotals(row.n, observedAt, computedAt);
  }

  /**
   * Прод 08.11: один проход json_extract по 463 000 кластерам держал очередь
   * обслуживания до 42 с на холодном кэше. Порции по rowid с паузой между ними;
   * кластер, изменившийся между порциями, считается в своём новом виде.
   */
  async recomputeCatalogTotalsInSlices(
    observedAt: string,
    options: CatalogTotalsSliceOptions = {},
  ): Promise<CatalogTotalsRow> {
    const sliceRows = options.sliceRows ?? CATALOG_TOTALS_SLICE_ROWS;
    const pause =
      options.pause ??
      (() => new Promise<void>((done) => setTimeout(done, CATALOG_TOTALS_SLICE_PAUSE_MS)));
    const computedAt = options.computedAt ?? new Date().toISOString();
    // B641 10.11: на проде первая порция держала цикл до 4,9 с, а свод мест в
    // конце — ещё ~2 с. На файловой базе оба чтения идут в своём потоке.
    if (this.database.location() && options.sliceRows === undefined) {
      const [activeRows, listingRows] = await Promise.all([
        readInWorker<{ active: number }>(this.database, CATALOG_ACTIVE_CLUSTERS_SQL),
        readInWorker<CatalogListingRow>(this.database, CATALOG_LISTINGS_SQL),
      ]);
      return this.writeCatalogTotals(
        activeRows[0]?.active ?? 0,
        observedAt,
        computedAt,
        listingRows.map(listingSummaryOf),
      );
    }
    const slice = this.database.prepare(
      `SELECT count(*) AS seen, max(rowid) AS last,
              coalesce(sum(json_extract(cluster_json, '$.status') = 'active'), 0) AS active
         FROM (SELECT rowid, cluster_json FROM vacancy_clusters
                WHERE rowid > ? ORDER BY rowid LIMIT ?)`,
    );
    let lastRowid = 0;
    let active = 0;
    for (;;) {
      const row = slice.get(lastRowid, sliceRows) as {
        seen: number;
        last: number | null;
        active: number;
      };
      active += row.active;
      if (row.last === null) break;
      lastRowid = row.last;
      if (row.seen < sliceRows) break;
      await pause();
    }
    return this.writeCatalogTotals(active, observedAt, computedAt);
  }

  private writeCatalogTotals(
    clusters: number,
    observedAt: string,
    computedAt: string,
    listings: CatalogListingSummary[] = this.countCatalogListings(),
  ): CatalogTotalsRow {
    this.database
      .prepare(
        `INSERT INTO catalog_totals (id, catalog_total, observed_at, computed_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET catalog_total = excluded.catalog_total,
           observed_at = excluded.observed_at, computed_at = excluded.computed_at`,
      )
      .run(clusters, observedAt, computedAt);
    this.database
      .prepare(
        `INSERT INTO catalog_listings (id, listings_json, computed_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET listings_json = excluded.listings_json,
           computed_at = excluded.computed_at`,
      )
      .run(JSON.stringify(listings), computedAt);
    return { clusters, updatedAt: observedAt, computedAt };
  }

  readCatalogTotals(): CatalogTotalsRow | undefined {
    const row = this.database
      .prepare('SELECT catalog_total, observed_at, computed_at FROM catalog_totals WHERE id = 1')
      .get() as { catalog_total: number; observed_at: string; computed_at: string } | undefined;
    return row
      ? { clusters: row.catalog_total, updatedAt: row.observed_at, computedAt: row.computed_at }
      : undefined;
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
    const salaryLabel = row.salary_label ? normalizeSalaryLabel(row.salary_label) : '';
    return {
      clusterId: row.cluster_id,
      key: row.entry_key,
      path: row.path,
      title: row.title,
      company: row.company,
      ...(row.location ? { location: row.location } : {}),
      isRemote: row.is_remote === 1,
      ...(salaryLabel ? { salaryLabel } : {}),
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

  /** Walks every active row (`path <> ''` is in no index): ~1.4 s on prod; the engine passes a cached total for big groups. */
  private countCatalogEntries(condition: string, params: readonly SQLInputValue[]): number {
    return (
      this.database
        .prepare(`SELECT count(*) AS n FROM catalog_entries WHERE ${condition}`)
        .get(...params) as { n: number }
    ).n;
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
    const total = query.knownTotal ?? this.countCatalogEntries(where.join(' AND '), filterParams);

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

  /** Maintenance writes them with the totals; until its first pass they are counted here. */
  loadCatalogListings(): CatalogListingSummary[] {
    const stored = this.database
      .prepare('SELECT listings_json FROM catalog_listings WHERE id = 1')
      .get() as { listings_json: string } | undefined;
    if (stored) {
      try {
        const parsed: unknown = JSON.parse(stored.listings_json);
        if (Array.isArray(parsed)) return parsed as CatalogListingSummary[];
      } catch {
        // A damaged row is counted again below, as before maintenance wrote one.
      }
    }
    return this.countCatalogListings();
  }

  private countCatalogListings(): CatalogListingSummary[] {
    const rows = this.database
      .prepare(CATALOG_LISTINGS_SQL)
      .all() as unknown as CatalogListingRow[];
    return rows.map(listingSummaryOf);
  }

  getCatalogSalaryStats(query: { place: string; role?: string }): SalaryStats | undefined {
    return readCatalogSalaryStats(this.database, query);
  }

  getCatalogChipCounts(listKey: string): ChipCounts {
    return readCatalogChipCounts(this.database, listKey);
  }

  /** B574: `limit + 1` keys by primary-key range, then those rows by the unique key. */
  loadCatalogChipPage(query: CatalogChipQuery): CatalogEntriesPage {
    const limit = Math.max(1, Math.min(Math.trunc(query.limit), 500));
    const keys = readCatalogChipKeys(this.database, { ...query, limit: limit + 1 }, Date.now());
    const hasNext = keys.length > limit;
    const selected = hasNext ? keys.slice(0, limit) : keys;
    const items = selected
      .map((key) => this.getCatalogEntry(key.entryKey))
      .filter((entry): entry is CatalogEntryRow => entry !== undefined);
    const last = selected.at(-1);
    return {
      items,
      total: this.getCatalogChipCounts(query.listKey)[query.chip] ?? 0,
      ...(hasNext && last
        ? { nextCursor: { publishedMs: last.publishedMs, key: last.entryKey } }
        : {}),
    };
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

  /**
   * Сохранённый кластер по ключу `member` (B247 S5) — тот же индексный запрос,
   * что и в `candidateClusterIds`, но на один ключ и без подъёма партии.
   */
  clusterIdForMemberKey(key: string): string | undefined {
    const row = this.database
      .prepare('SELECT cluster_id FROM vacancy_cluster_keys WHERE kind = ? AND key = ? LIMIT 1')
      .get('member', key) as { cluster_id: string } | undefined;
    return row?.cluster_id;
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

  /**
   * Блокировка записи берётся сразу: транзакция читает свои строки до записи
   * (сохранение дочитанного текста, B535), и отложенный BEGIN тогда поднимает
   * снимок чтения до записи — SQLite отвечает «database is locked» без ожидания,
   * если другой процесс успел закоммитить. IMMEDIATE ждёт по busy_timeout.
   */
  private inTransaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE');
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

/** Id записей пула, которые держат кластер живым: основатель и все источники. */
function clusterMemberIds(clusterId: string, clusterJson: string): string[] | null {
  const ids = new Set<string>();
  if (clusterId.startsWith('cluster-')) ids.add(clusterId.slice('cluster-'.length));
  try {
    const cluster = JSON.parse(clusterJson) as { sources?: VacancyCluster['sources'] };
    for (const source of cluster.sources ?? []) {
      if (source.externalId) ids.add(`${source.sourceId}:${source.externalId}`);
      if (source.sourceUrl) ids.add(`${source.sourceId}:${source.sourceUrl}`);
    }
  } catch {
    // Нечитаемый кластер не доказывает, что членов нет: оставить его как есть.
    return null;
  }
  return [...ids];
}

export interface HhTextCandidates {
  readonly ids: string[];
  readonly cursor?: string;
}

interface HhTextPosition {
  /** The public catalog, then the rest of the pool; candidates' roles have their own position (04.11). */
  readonly phase: 'catalog' | 'pool';
  readonly ms: number;
  readonly key: string;
}

const HH_TEXT_PAGE = 200;
const HH_TEXT_SCAN_LIMIT = 2_000;
/** Цели кампаний, чей подбор считался за последние 14 дней: активные кампании. */
const HH_TEXT_TARGET_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const HH_TEXT_MAX_TARGETS = 50;
const HH_TEXT_TARGET_REFRESH_MS = 60 * 60 * 1_000;

/** Живая hh-запись, которой нужен текст: не снята, текста нет, работодатель его не скрыл. */
const HH_NEEDS_TEXT = `p.expired_at IS NULL AND
      length(trim(coalesce(json_extract(p.payload, '$.fullDescription'), ''))) = 0 AND
      coalesce(json_extract(p.payload, '$.descriptionHidden'), 0) = 0`;
const HH_TEXT_PHASES = ['catalog', 'pool'] as const;

function nextHhTextPhase(at: HhTextPosition): HhTextPosition | undefined {
  const phase = HH_TEXT_PHASES[HH_TEXT_PHASES.indexOf(at.phase) + 1];
  return phase ? { phase, ms: Number.MAX_SAFE_INTEGER, key: '' } : undefined;
}

function parseHhTextCursor(cursor: string | undefined): HhTextPosition {
  const start: HhTextPosition = { phase: 'catalog', ms: Number.MAX_SAFE_INTEGER, key: '' };
  if (!cursor) return start;
  const [phase, ms, ...key] = cursor.split('|');
  const parsedMs = Number(ms);
  if (!HH_TEXT_PHASES.includes(phase as HhTextPosition['phase']) || !Number.isFinite(parsedMs)) {
    return start;
  }
  return { phase: phase as HhTextPosition['phase'], ms: parsedMs, key: key.join('|') };
}

function formatHhTextCursor(at: HhTextPosition): string {
  return `${at.phase}|${at.ms}|${at.key}`;
}

interface PreparedUpsertRow {
  readonly vacancy: UnifiedVacancy;
  readonly previous: UnifiedVacancy | undefined;
  readonly stored: UnifiedVacancy;
  readonly payload: string;
  readonly projection: string;
  /** Stored payload length when the snapshot was read; undefined for a new row. */
  readonly bytes: number | undefined;
}

function mergesStoredSnapshot(sourceId: string): boolean {
  return sourceId === HH_SEARCH_SOURCE_ID || isDetailTextSource(sourceId);
}

/** A repeated id in one chunk merges onto the row written just before it. */
function mergeUpsertRows(
  sourceId: string,
  chunk: readonly UnifiedVacancy[],
  existing: ReadonlyMap<string, UnifiedVacancy>,
  bytes: ReadonlyMap<string, number>,
): readonly PreparedUpsertRow[] {
  const latest = new Map(existing);
  return chunk.map((vacancy) => {
    const previous = latest.get(vacancy.id);
    const stored = previous ? mergeStoredSnapshot(sourceId, previous, vacancy) : vacancy;
    latest.set(vacancy.id, stored);
    return {
      vacancy,
      previous,
      stored,
      payload: JSON.stringify(stored),
      projection: JSON.stringify(clusterProjectionOf(stored)),
      bytes: bytes.get(vacancy.id),
    };
  });
}

/** Повторная запись площадки не стирает дочитанный текст (hh — B304, Workday и др. — B535). */
function mergeStoredSnapshot(
  sourceId: string,
  previous: UnifiedVacancy,
  incoming: UnifiedVacancy,
): UnifiedVacancy {
  if (sourceId === HH_SEARCH_SOURCE_ID) return mergeHhVacancySnapshot(previous, incoming);
  if (isDetailTextSource(sourceId)) return mergeWorkdaySnapshot(previous, incoming);
  return incoming;
}

export function parseVacancy(payload: string): UnifiedVacancy | undefined {
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

/** Текст дочитан этой записью впервые: сведение должно поискать двойника (01.11). */
function gainedFullText(previous: UnifiedVacancy | undefined, stored: UnifiedVacancy): boolean {
  return Boolean(previous && !previous.fullDescription?.trim() && stored.fullDescription?.trim());
}
