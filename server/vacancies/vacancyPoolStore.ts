import type { UnifiedVacancy, VacancyCluster, VacancySourceConfig } from '../domain/unifiedVacancy';
import type { ClusterRepresentative, VacancyClusterLookup } from './vacancyDeduplicator';
import type { SourceObservations } from './sourceHealthVerdict';
import type { CandidateMatchProfile } from './vacancyMatcher';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import type {
  ClusterProjection,
  FreshnessWindow,
  MatchCandidateQueryOptions,
  VacancyPoolPage,
  VacancyPoolQuery,
} from './vacancyPoolQuery';
import type {
  CatalogCursor,
  CatalogEntriesPage,
  CatalogEntriesQuery,
  CatalogEntryRow,
} from './vacancyCatalogProjection';

export type { ClusterProjection, MatchCandidateQueryOptions };
export type { CatalogCursor, CatalogEntriesPage, CatalogEntriesQuery, CatalogEntryRow };

/** What a source's last reading recorded, kept apart from the source's config. */
export interface StoredSourceState {
  readonly sourceId: string;
  readonly lastSyncAt?: string;
  readonly lastStatus?: VacancySourceConfig['lastStatus'];
  readonly lastErrorMessage?: string;
  readonly itemsFoundTotal: number;
  readonly itemsActiveTotal: number;
  readonly syncRequestedAt?: string;
  readonly syncStartedAt?: string;
  /**
   * Что опросы установили про площадку. Живость считается по наблюдениям,
   * которые копятся днями, а процесс живёт часы: без записи на диск каждый
   * деплой объявлял бы любую площадку «ещё ни разу не опрошенной» (B200).
   */
  readonly observations?: SourceObservations;
}

/** Что снял `mergeSourceSlice`: по этим ссылкам записи покидают кластеры (B230). */
export interface MergeSliceResult {
  readonly dropped: readonly VacancyLink[];
}

/** Ссылка объявления без остальной записи — всё, что нужно обходу живости. */
export interface VacancyLink {
  readonly id: string;
  readonly url: string;
}

/**
 * Storage behind the vacancy pool. Since B221 it is also where the pool is
 * read from: the engine keeps no copy in the heap, so memory follows the size
 * of a request rather than the size of the pool. Before that the store only
 * made the pool outlive the process (B164).
 */
export interface VacancyPoolStore {
  /** Непохороненные записи; с окном — только свежие (вход сведения кластеров). */
  loadVacancies(window?: FreshnessWindow): UnifiedVacancy[];
  /**
   * Вход сведения по одной записи: компактная проекция (`clusterProjectionOf`),
   * а не запись целиком — без подъёма среза и полных текстов в кучу.
   */
  iterateClusterInput(window: FreshnessWindow): IterableIterator<UnifiedVacancy>;
  /** Одна запись целиком, похороненная не отдаётся. */
  getVacancy(id: string): UnifiedVacancy | undefined;
  hasVacancy(id: string): boolean;
  countVacancies(window: FreshnessWindow): number;
  countBySource(window: FreshnessWindow): ReadonlyMap<string, number>;
  /** Срез площадки как он лежит: сколько записей и сколько из них активных. */
  countSourceSlice(sourceId: string): { total: number; active: number };
  /** Все source_id, включая записи, которых нет в текущем registry (B235). */
  countAllSourceSlices?(): ReadonlyMap<string, { total: number; active: number }>;
  queryVacancies(query: VacancyPoolQuery): VacancyPoolPage;
  loadSourceLinks(sourceId: string): VacancyLink[];
  /**
   * Подвыборка записей для подбора кандидату (B221 срез 2).
   * Отбирает компактные проекции сразу из хранилища по целевым ролям, навыкам
   * и удалёнке, добирая до лимита свежими активными вакансиями.
   */
  queryMatchCandidates?(
    candidate: CandidateMatchProfile,
    options?: MatchCandidateQueryOptions,
  ): UnifiedVacancy[];
  /** File-backed matching runs outside the HTTP event loop. */
  queryMatchCandidatesAsync?(
    candidate: CandidateMatchProfile,
    options?: MatchCandidateQueryOptions,
  ): Promise<UnifiedVacancy[]>;
  /**
   * Режим подбора для этого кандидата (B267 S3): пусто — legacy. Вызывающая
   * сторона (движок) использует тот же результат и для запроса, и для
   * объяснения `roleMatch`, чтобы оба не разошлись по режиму.
   */
  resolveSemanticFunctions?(candidate: CandidateMatchProfile): readonly FunctionCode[];
  /**
   * Один шаг дочитывания колонок запросов у записей, сделанных до B221.
   * Возвращает, сколько строк обработано; ноль — дочитывать нечего. Пул в
   * памяти этого не знает: у него нечего дочитывать.
   */
  backfillStep?(chunk?: number): number;
  /**
   * Дополняет срез площадки частичным чтением: прочитанное обновляется,
   * непрочитанное остаётся (B214). С `dropObservedBefore` снимает записи,
   * которых ни один тик не видел с начала полного перечисления (B219).
   */
  mergeSourceSlice(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
    dropObservedBefore?: string,
  ): MergeSliceResult;
  /** Async bounded-write variants used by the maintenance worker (B230). */
  mergeSourceSliceAsync?(
    sourceId: string,
    vacancies: readonly UnifiedVacancy[],
    dropObservedBefore?: string,
  ): Promise<MergeSliceResult>;
  loadSourceStates(): StoredSourceState[];
  /** Queues an out-of-band source read for the maintenance process (B231). */
  requestSourceSync?(sourceId: string, requestedAt: string): void;
  /** Marks the same request as running without overwriting a newer request. */
  markSourceSyncStarted?(sourceId: string, requestedAt: string, startedAt: string): boolean;
  /** Clears a request only when it is still the request that was processed. */
  clearSourceSyncRequest?(sourceId: string, requestedAt: string): boolean;
  /** Swaps everything this source contributed for what it just returned. */
  replaceSourceSlice(sourceId: string, vacancies: readonly UnifiedVacancy[]): void;
  /** Async bounded-write variant that yields between SQLite transactions. */
  replaceSourceSliceAsync?(sourceId: string, vacancies: readonly UnifiedVacancy[]): Promise<void>;
  saveSourceState(state: StoredSourceState): void;
  /**
   * Помечает снятые объявления датой смерти, оставляя их в базе. Возвращает,
   * сколько записей похоронено этим вызовом (B200 срез 2).
   */
  markExpired(vacancyIds: readonly string[], atIso: string): number;
  /** Drops rows of sources the registry no longer knows and stale readings. */
  prune(knownSourceIds: readonly string[], oldestPublishedAt: string): void;
  /**
   * Устойчивое хранение и инкрементальное обновление кластеров (B221 срез 3).
   */
  saveClusters(clusters: VacancyCluster[]): void;
  /** Atomically replaces the persisted cluster snapshot, including an empty snapshot. */
  replaceClusters?(clusters: VacancyCluster[]): void;
  loadClusters(): VacancyCluster[];
  /** Bounded cluster page for public catalog reads; must not hydrate the pool. */
  loadClustersPage?(limit: number, offset?: number): VacancyCluster[];
  /** Removes stale persisted clusters without loading their JSON into the heap. */
  pruneClustersBefore?(oldestPublishedAt: string): number;
  upsertCluster(cluster: VacancyCluster): void;
  deleteCluster(clusterId: string): void;
  countClusters(): number;
  /**
   * Сведение по ключам (B230): соседи партии из `vacancy_cluster_keys`,
   * резюмируемое заполнение ключей по старым кластерам и его готовность.
   */
  loadClustersByKeys?(lookups: readonly VacancyClusterLookup[]): VacancyCluster[];
  loadClusterRepresentatives?(lookups: readonly VacancyClusterLookup[]): ClusterRepresentative[];
  backfillClusterKeysStep?(chunk?: number): number;
  clusterKeysReady?(): boolean;
  /** Materialized public catalog (B229); absent while its bounded backfill runs. */
  loadCatalogEntriesPage?(query: CatalogEntriesQuery): CatalogEntriesPage;
  loadCatalogListings?(): Array<{
    place: string;
    placeLabel: string;
    role?: string;
    roleLabel?: string;
    path: string;
    count: number;
  }>;
  getCatalogEntry?(key: string): CatalogEntryRow | undefined;
  getCluster?(clusterId: string): VacancyCluster | undefined;
  /**
   * Запись независимо от того, снята ли она (B247 S5): нужна только чтобы
   * достать `externalId`/`sourceUrl` для поиска кластера по ключу `member`,
   * без данных наружу.
   */
  getVacancyIncludingExpired?(id: string): UnifiedVacancy | undefined;
  /** Точечный поиск сохранённого кластера по ключу `member` (B247 S5). */
  clusterIdForMemberKey?(key: string): string | undefined;
  catalogProjectionReady?(): boolean;
  /** One bounded maintenance tick; returns rows inspected. */
  backfillCatalogEntriesStep?(chunk?: number): number;
  /** Number of cluster rows still absent from the projection marker. */
  pendingCatalogEntries?(): number;
}
