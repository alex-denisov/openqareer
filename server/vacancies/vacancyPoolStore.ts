import type { UnifiedVacancy, VacancyCluster, VacancySourceConfig } from '../domain/unifiedVacancy';
import type { SourceObservations } from './sourceHealthVerdict';
import type { CandidateMatchProfile } from './vacancyMatcher';
import type {
  ClusterProjection,
  FreshnessWindow,
  MatchCandidateQueryOptions,
  VacancyPoolPage,
  VacancyPoolQuery,
} from './vacancyPoolQuery';

export type { ClusterProjection, MatchCandidateQueryOptions };

/** What a source's last reading recorded, kept apart from the source's config. */
export interface StoredSourceState {
  readonly sourceId: string;
  readonly lastSyncAt?: string;
  readonly lastStatus?: VacancySourceConfig['lastStatus'];
  readonly lastErrorMessage?: string;
  readonly itemsFoundTotal: number;
  readonly itemsActiveTotal: number;
  /**
   * Что опросы установили про площадку. Живость считается по наблюдениям,
   * которые копятся днями, а процесс живёт часы: без записи на диск каждый
   * деплой объявлял бы любую площадку «ещё ни разу не опрошенной» (B200).
   */
  readonly observations?: SourceObservations;
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
  ): void;
  loadSourceStates(): StoredSourceState[];
  /** Swaps everything this source contributed for what it just returned. */
  replaceSourceSlice(sourceId: string, vacancies: readonly UnifiedVacancy[]): void;
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
  upsertCluster(cluster: VacancyCluster): void;
  deleteCluster(clusterId: string): void;
  countClusters(): number;
}
