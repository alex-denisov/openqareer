import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import type { SourceObservations } from './sourceHealthVerdict';

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

/**
 * Storage behind the vacancy pool. The engine holds the pool in memory for
 * reads; this interface is what makes the pool outlive the process (B164).
 */
export interface VacancyPoolStore {
  loadVacancies(): UnifiedVacancy[];
  loadSourceStates(): StoredSourceState[];
  /** Swaps everything this source contributed for what it just returned. */
  replaceSourceSlice(sourceId: string, vacancies: UnifiedVacancy[]): void;
  saveSourceState(state: StoredSourceState): void;
  /**
   * Помечает снятые объявления датой смерти, оставляя их в базе. Возвращает,
   * сколько записей похоронено этим вызовом (B200 срез 2).
   */
  markExpired(vacancyIds: readonly string[], atIso: string): number;
  /** Drops rows of sources the registry no longer knows and stale readings. */
  prune(knownSourceIds: readonly string[], oldestPublishedAt: string): void;
}
