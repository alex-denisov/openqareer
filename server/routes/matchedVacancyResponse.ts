import { campaignMeta } from './campaignContext';
import type { CampaignResolution } from '../vacancies/campaign';

export function unconfirmedCandidateMatchResponse(
  requestId: string,
  offset: number,
  campaign: CampaignResolution,
) {
  return {
    data: [],
    meta: {
      requestId,
      reason: 'candidate_profile_unconfirmed',
      total: 0,
      offset,
      nextOffset: null,
      ...(offset === 0 ? { pageOffsets: [0] } : {}),
      campaign: campaignMeta(campaign),
    },
  };
}
