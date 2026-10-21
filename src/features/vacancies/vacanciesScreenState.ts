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
  readonly salaryMinimum?: number;
  readonly salaryMaximum?: number;
  readonly salaryCurrency?: string;
  readonly includeMissingSalary?: boolean;
  /** B546: a vacancy without salary is compared by its market estimate. */
  readonly useMarketEstimate?: boolean;
  readonly formats?: readonly string[];
}
