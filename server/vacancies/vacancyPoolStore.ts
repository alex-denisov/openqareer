import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';

/** What a source's last reading recorded, kept apart from the source's config. */
export interface StoredSourceState {
  readonly sourceId: string;
  readonly lastSyncAt?: string;
  readonly lastStatus?: VacancySourceConfig['lastStatus'];
  readonly lastErrorMessage?: string;
  readonly itemsFoundTotal: number;
  readonly itemsActiveTotal: number;
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
  /** Drops rows of sources the registry no longer knows and stale readings. */
  prune(knownSourceIds: readonly string[], oldestPublishedAt: string): void;
}
