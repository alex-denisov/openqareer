export interface VacanciesScreenState {
  readonly sort?: 'fit' | 'freshness';
  readonly roles: readonly string[];
  readonly regions: readonly string[];
  readonly levels?: readonly string[];
  readonly sources?: readonly string[];
  readonly remoteOnly: boolean;
  readonly freshnessDays?: number;
  readonly selectedCity?: string;
  /** B553: «Показать список» у кластера карты — все его города сразу. */
  readonly selectedCities?: readonly string[];
  readonly selectedLocations?: readonly string[];
  readonly locationSearch?: string;
  /** «Удалённо, из любой страны» в фильтре «Локации» (B547). */
  readonly locationRemote?: boolean;
  readonly salaryMinimum?: number;
  readonly salaryMaximum?: number;
  readonly salaryCurrency?: string;
  readonly includeMissingSalary?: boolean;
  /** B546: a vacancy without salary is compared by its market estimate. */
  readonly useMarketEstimate?: boolean;
  readonly formats?: readonly string[];
  /** B439: «Все N вакансий компании в подборке» narrows the selection to one company. */
  readonly companyName?: string;
}
