import { describe, expect, it } from 'vitest';
import { buildLinkageIndex } from './placementLinkage';
import { placementOf, PLACEMENT_PRIORITY } from './placementModel';

const index = buildLinkageIndex([
  { companyKey: 'stripe', companyName: 'Stripe', websiteUrl: 'https://stripe.com', atsProvider: 'greenhouse', atsSlug: 'stripe' },
  { companyKey: 'tonies', companyName: 'tonies', websiteUrl: 'https://tonies.com', atsProvider: null, atsSlug: null },
]);

describe('placementOf', () => {
  it('builds an ATS board placement with a deterministic id', () => {
    expect(placementOf('ats-greenhouse-stripe', index)).toEqual({
      placementId: 'ats:greenhouse:stripe', companyKey: 'stripe', type: 'ats', provider: 'greenhouse',
      slug: 'stripe', priority: PLACEMENT_PRIORITY.ats, sourceId: 'ats-greenhouse-stripe',
    });
  });
  it('keeps an unknown board without a company', () => {
    expect(placementOf('src-fh-icims-adlittle', index)).toMatchObject({
      placementId: 'ats:icims:adlittle', companyKey: null, type: 'ats', provider: 'icims', slug: 'adlittle',
    });
  });
  it('builds a site placement keyed by the source id', () => {
    expect(placementOf('src-company-site-tonies', index)).toMatchObject({
      placementId: 'site:src-company-site-tonies', companyKey: 'tonies', type: 'employer_site', priority: 1,
    });
  });
  it('builds aggregator and hh placements without a company', () => {
    expect(placementOf('src-hh-search', index)).toMatchObject({ placementId: 'agg:src-hh-search', companyKey: null, type: 'aggregator', priority: 4 });
    expect(placementOf('src-linkedin-guest', index)).toMatchObject({ type: 'linkedin', priority: 3, companyKey: null });
  });
  it('orders priority site < ats < linkedin < aggregator', () => {
    expect([PLACEMENT_PRIORITY.employer_site, PLACEMENT_PRIORITY.ats, PLACEMENT_PRIORITY.linkedin, PLACEMENT_PRIORITY.aggregator]).toEqual([1, 2, 3, 4]);
  });
});
