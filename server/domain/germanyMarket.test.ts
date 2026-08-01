import { describe, expect, it } from 'vitest';
import {
  evaluateGermanyMarket,
  germanyMarketSubmissionSchema,
} from './germanyMarket';

const base = {
  workAuthorization: 'none',
  jobOffer: 'yes',
  grossAnnualSalaryEur: 55_000,
  offerDurationMonths: 24,
  qualification: 'recognized-comparable',
  professionRegulation: 'non-regulated',
  blueCardBand: 'general',
  fundsMonthlyEur: null,
  languageEvidence: 'english-b2-plus',
  relocationReadiness: 'ready',
  dependants: 'none',
  targetWorkMode: 'hybrid',
} as const;

describe('Germany market route pack', () => {
  it('shows a Blue Card signal with the exact dated threshold and evidence', () => {
    const result = evaluateGermanyMarket(
      germanyMarketSubmissionSchema.parse(base),
      new Date('2026-08-01T00:00:00Z'),
    );

    expect(result.packStatus).toBe('current');
    expect(result.recommendedRouteId).toBe('eu-blue-card');
    expect(result.routes[0]).toMatchObject({
      id: 'eu-blue-card',
      status: 'strong-signal',
      threshold: { amountEur: 50_700, validForYear: 2026 },
      missingEvidence: [],
    });
    expect(result.routes[0].evidence[0]).toMatch(
      /^Предложение: €55.000 брутто в год$/,
    );
    expect(result.caveat).toMatch(/не юридическое решение/i);
  });

  it('never assumes eligibility when offer, recognition or funds are unknown', () => {
    const result = evaluateGermanyMarket(
      {
        ...base,
        jobOffer: 'in-progress',
        grossAnnualSalaryEur: null,
        offerDurationMonths: null,
        qualification: 'unknown',
        professionRegulation: 'unknown',
        blueCardBand: 'unknown',
        fundsMonthlyEur: null,
        languageEvidence: 'unknown',
      },
      new Date('2026-08-01T00:00:00Z'),
    );

    expect(result.recommendedRouteId).toBeNull();
    expect(result.routes.find((route) => route.id === 'eu-blue-card')).toMatchObject({
      status: 'possible-needs-check',
      missingEvidence: expect.arrayContaining([
        expect.stringMatching(/подписанное предложение/i),
        expect.stringMatching(/квалификац/i),
      ]),
    });
  });

  it('routes a no-offer search toward an Opportunity Card check, not approval', () => {
    const result = evaluateGermanyMarket(
      {
        ...base,
        jobOffer: 'no',
        grossAnnualSalaryEur: null,
        offerDurationMonths: null,
        qualification: 'state-recognized-origin',
        blueCardBand: 'unknown',
        fundsMonthlyEur: 1_200,
      },
      new Date('2026-08-01T00:00:00Z'),
    );

    expect(result.recommendedRouteId).toBe('opportunity-card');
    expect(result.routes.find((route) => route.id === 'opportunity-card')).toMatchObject({
      status: 'possible-needs-check',
      threshold: { amountEur: 1_091, cadence: 'monthly', validForYear: 2026 },
    });
  });

  it('fails closed when the annual official rule pack is stale', () => {
    const result = evaluateGermanyMarket(base, new Date('2027-01-02T00:00:00Z'));

    expect(result.packStatus).toBe('stale');
    expect(result.recommendedRouteId).toBeNull();
    expect(result.routes).toEqual([]);
    expect(result.globalMissingEvidence[0]).toMatch(/обновить/i);
  });
});
