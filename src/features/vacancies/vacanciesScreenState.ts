export interface VacanciesScreenState {
  readonly sort?: 'fit' | 'freshness';
  readonly roles: readonly string[];
  readonly regions: readonly string[];
  readonly levels?: readonly string[];
  readonly sources?: readonly string[];
  readonly remoteOnly: boolean;
  readonly freshnessDays?: number;
  readonly selectedCity?: string;
  readonly selectedLocations?: readonly string[];
  readonly locationSearch?: string;
  /** «Удалённо, из любой страны» в фильтре «Локации» (B547). */
  readonly locationRemote?: boolean;
  readonly salaryMinimum?: number;
  readonly salaryMaximum?: number;
  readonly salaryCurrency?: string;
  readonly includeMissingSalary?: boolean;
  readonly formats?: readonly string[];
}
