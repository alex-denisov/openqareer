import { describe, expect, it } from 'vitest';
import { resolveCampaign } from '../vacancies/campaign';
import { campaignMeta } from './campaignContext';
import { unconfirmedCandidateMatchResponse } from './matchedVacancyResponse';

describe('unconfirmedCandidateMatchResponse', () => {
  const campaign = resolveCampaign({
    memory: [],
    profileRegions: [],
    resumeTargetRole: null,
    explicit: null,
  });

  it('returns the empty first page with campaign metadata', () => {
    expect(unconfirmedCandidateMatchResponse('request-1', 0, campaign)).toEqual({
      data: [],
      meta: {
        requestId: 'request-1',
        reason: 'candidate_profile_unconfirmed',
        total: 0,
        offset: 0,
        nextOffset: null,
        pageOffsets: [0],
        campaign: campaignMeta(campaign),
      },
    });
  });

  it('does not advertise first-page offsets for a nonzero offset', () => {
    expect(unconfirmedCandidateMatchResponse('request-2', 20, campaign).meta).not.toHaveProperty(
      'pageOffsets',
    );
  });
});
