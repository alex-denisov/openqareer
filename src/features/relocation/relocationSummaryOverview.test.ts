import { describe, expect, it } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import {
  buildRelocationSummaryOverview,
  relocationCountsSentence,
} from './relocationSummaryOverview';
import { buildCountryComparisonCountry } from './relocationCountryData';
import { summarizeRelocationCountry } from './relocationCountrySummary';
import { listRelocationCountries } from './relocationCountryData';

function serbianPermitProfile() {
  const empty = emptyRelocationQuestionnaire();
  return {
    ...empty,
    citizenshipDocuments: {
      citizenshipCountryCodes: ['RU'],
      documents: [
        { id: 'd1', kind: 'residence_permit' as const, countryCode: 'RS', expiresAt: '2099-06-30' },
      ],
    },
  };
}

describe('relocation summary overview (B468-r3)', () => {
  it('Serbia with a valid permit is a key country, open, with the permit as the reason', () => {
    const overview = buildRelocationSummaryOverview(serbianPermitProfile());
    const serbia = overview.key.find(({ countryCode }) => countryCode === 'RS');
    expect(serbia?.status).toBe('available');
    expect(serbia?.reason).toBe('Действует ВНЖ до 30.06.2099.');
    const total = Object.values(overview.counts).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(listRelocationCountries().length);
  });

  it('a reason comes from the leading scenario, not the first scenario', () => {
    const overview = buildRelocationSummaryOverview(serbianPermitProfile());
    for (const summary of overview.key) {
      expect(summary.reason).not.toBe('Укажите гражданство или текущую страну проживания.');
    }
  });

  it('the list and the comparison use one status label', () => {
    const profile = serbianPermitProfile();
    for (const country of listRelocationCountries()) {
      const summary = summarizeRelocationCountry(country, profile);
      const access = buildCountryComparisonCountry(country.countryCode, profile).facts.access;
      if (access.status === 'available') expect(access.value.label).toBe(summary.statusLabel);
    }
  });

  it('the counts sentence skips empty statuses', () => {
    expect(
      relocationCountsSentence({
        available: 3,
        high_barriers: 2,
        legally_unavailable: 0,
        unknown: 1,
      }),
    ).toBe('Доступно без ограничений 3 страны, с высокими барьерами 2, нужно уточнить 1.');
  });
});
