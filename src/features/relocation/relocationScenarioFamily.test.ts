import { describe, expect, it } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import {
  RELOCATION_CITIES,
  RELOCATION_CURRENCIES,
  scenarioFamilyFromProfile,
  scenarioHouseholdSize,
  scenarioPayrollOptions,
} from './relocationScenarioFamily';

describe('scenario family: partner and children drive the budget', () => {
  it('takes the partner and children from the questionnaire', () => {
    const profile = emptyRelocationQuestionnaire();
    const withKids = {
      ...profile,
      family: { ...profile.family, partnerStatus: 'has_partner' as const, childrenCount: 2 },
    };
    expect(scenarioFamilyFromProfile(withKids)).toEqual({ hasPartner: true, children: 2 });
    expect(scenarioFamilyFromProfile(profile)).toEqual({ hasPartner: false, children: 0 });
  });

  it('counts everyone who moves in the budget', () => {
    expect(scenarioHouseholdSize({ hasPartner: false, children: 0 })).toBe(1);
    expect(scenarioHouseholdSize({ hasPartner: true, children: 0 })).toBe(2);
    expect(scenarioHouseholdSize({ hasPartner: true, children: 3 })).toBe(5);
    expect(scenarioHouseholdSize({ hasPartner: false, children: 1 })).toBe(2);
  });

  it('applies the German childless care surcharge only without children', () => {
    expect(scenarioPayrollOptions('DE', { hasPartner: false, children: 0 }, {})).toEqual({
      germanyChildless: true,
    });
    expect(scenarioPayrollOptions('DE', { hasPartner: true, children: 1 }, {})).toEqual({
      germanyChildless: false,
    });
    expect(
      scenarioPayrollOptions(
        'GE',
        { hasPartner: false, children: 0 },
        { georgiaPensionParticipant: true },
      ),
    ).toEqual({ georgiaPensionParticipant: true });
  });

  it('offers cities and currencies from fixed lists', () => {
    for (const code of ['DE', 'CY', 'RS', 'AE', 'GE', 'RU']) {
      expect(RELOCATION_CITIES[code as keyof typeof RELOCATION_CITIES].length).toBeGreaterThan(1);
    }
    expect(RELOCATION_CURRENCIES).toContain('EUR');
    expect(RELOCATION_CURRENCIES.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
  });
});
