import { buildMatchedVacancyFacets } from '../vacancies/matchedVacancyFacets';
import type { MatchedVacancySourceDefinition } from '../vacancies/matchedVacancyFacets';
import { campaignMeta } from './campaignContext';
import type { CampaignResolution } from '../vacancies/campaign';

export function unconfirmedCandidateMatchResponse(
  requestId: string,
  offset: number,
  campaign: CampaignResolution,
  sourceRegistry: readonly MatchedVacancySourceDefinition[] = [],
) {
  return {
    data: [],
    meta: {
      requestId,
      reason: 'candidate_profile_unconfirmed',
      total: 0,
      offset,
      nextOffset: null,
      ...(offset === 0
        ? {
            pageOffsets: [0],
            facets: buildMatchedVacancyFacets([], [], undefined, sourceRegistry),
          }
        : {}),
      campaign: campaignMeta(campaign),
    },
  };
}
