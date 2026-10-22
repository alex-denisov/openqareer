import type { CandidateRegion } from '../src/features/workspace/candidateRegions';

export const MATCHED_VACANCY_FACET_LEVELS = [
  'ic',
  'lead',
  'head',
  'vp',
  'c-level',
  'unknown',
] as const;
export type MatchedVacancyFacetLevel = (typeof MATCHED_VACANCY_FACET_LEVELS)[number];
export const MATCHED_VACANCY_SOURCE_GROUPS = [
  { id: 'platforms', name: 'Площадки' },
  { id: 'ats', name: 'ATS компаний' },
  { id: 'aggregators', name: 'Агрегаторы' },
  { id: 'channels', name: 'Каналы' },
] as const;

export type MatchedVacancySourceGroupId = (typeof MATCHED_VACANCY_SOURCE_GROUPS)[number]['id'];

export interface MatchedVacancySourceGroup {
  readonly id: MatchedVacancySourceGroupId;
  readonly name: string;
  readonly count: number;
}

export interface MatchedVacancyCatalogSummary {
  readonly roleLevelMatches: number;
  readonly catalogTotal: number;
  readonly observedAt?: string;
}

export interface MatchedVacancyPlaceFacet {
  readonly location?: string;
  readonly country?: string;
  readonly isRemote?: boolean;
  readonly region?: CandidateRegion;
  readonly count: number;
}

export interface MatchedVacancyFacets {
  readonly total: number;
  /** Optional source-backed count of role/level matches in the wider catalog. */
  readonly catalogSummary?: MatchedVacancyCatalogSummary;
  readonly regions: readonly { readonly id: CandidateRegion; readonly count: number }[];
  readonly remote: number;
  readonly levels: readonly { readonly level: MatchedVacancyFacetLevel; readonly count: number }[];
  readonly roles: readonly { readonly role: string; readonly count: number }[];
  readonly sources: readonly {
    readonly sourceId: string;
    readonly name: string;
    readonly count: number;
    /** Категория поповера «Источники»: реестр клиента знает не все источники выдачи. */
    readonly groupId?: MatchedVacancySourceGroupId;
  }[];
  /**
   * B446-r: места всей выдачи с числом вакансий — дерево «Локаций» считает по
   * ним, а не по загруженным строкам. `region` — регион кампании места.
   */
  readonly places?: readonly MatchedVacancyPlaceFacet[];
  readonly sourceGroups?: readonly MatchedVacancySourceGroup[];
}
