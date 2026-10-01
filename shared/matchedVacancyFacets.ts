import type { CandidateRegion } from '../src/features/workspace/candidateRegions';

export const MATCHED_VACANCY_FACET_LEVELS = ['ic', 'lead', 'head', 'vp', 'c-level', 'unknown'] as const;
export type MatchedVacancyFacetLevel = typeof MATCHED_VACANCY_FACET_LEVELS[number];
export interface MatchedVacancyFacets {
  readonly total: number;
  readonly regions: readonly { readonly id: CandidateRegion; readonly count: number }[];
  readonly remote: number;
  readonly levels: readonly { readonly level: MatchedVacancyFacetLevel; readonly count: number }[];
  readonly roles: readonly { readonly role: string; readonly count: number }[];
  readonly sources: readonly { readonly sourceId: string; readonly name: string; readonly count: number }[];
}
