// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  calculateCountryFitScenario,
  parseCountryFitScenario,
  saveCountryFitScenario,
  readCountryFitScenario,
  COUNTRY_FIT_STORAGE_KEY,
  clearCountryFitScenario,
  saveWithCountryFitTransfer,
  countryFitConstraint,
} from './countryFitScenario';
import { initialFirstRunData, firstRunDataToWorkspaceInput } from '../onboarding/firstRunStorage';

describe('public Country Fit scenario', () => {
  beforeEach(() => sessionStorage.clear());
  it('calculates payroll and a user budget without claiming market data', () => {
    const result = calculateCountryFitScenario('AE', '120000', ['3000', '500', '1500']);
    expect(result).toMatchObject({
      payroll: { netMonthlyIncome: 10000, currency: 'AED' },
      remainder: 5000,
    });
  });
  it('keeps unknown costs unknown and supports zero or negative disposable income', () => {
    expect(calculateCountryFitScenario('AE', '120000', ['', '0', '0'])).toMatchObject({
      remainder: undefined,
    });
    expect(calculateCountryFitScenario('AE', '0', ['1', '0', '0'])).toMatchObject({
      remainder: -1,
    });
  });
  it('rejects invalid income and costs rather than displaying NaN', () => {
    expect(calculateCountryFitScenario('DE', '', ['0', '0', '0'])).toHaveProperty('error');
    expect(calculateCountryFitScenario('DE', '-1', ['0', '0', '0'])).toHaveProperty('error');
    expect(calculateCountryFitScenario('DE', '60000', ['-1', '0', '0'])).toHaveProperty(
      'costsError',
    );
    expect(
      parseCountryFitScenario({ countryCode: 'US', grossAnnualIncome: 50000, currency: 'USD' }),
    ).toBeUndefined();
    expect(
      parseCountryFitScenario({ countryCode: 'DE', grossAnnualIncome: 50000, currency: 'USD' }),
    ).toBeUndefined();
  });
  it('consumes the saved scenario into visible onboarding context and submitted search constraints', () => {
    expect(
      saveCountryFitScenario({ countryCode: 'DE', grossAnnualIncome: 60000, currency: 'EUR' }),
    ).toBe(true);
    const data = initialFirstRunData();
    expect(data.context).toMatchObject({
      country: '',
      isRelocationReady: false,
      countryFitScenario: { grossAnnualIncome: 60000, currency: 'EUR' },
    });
    expect(data.context.city).toBe('');
    expect(firstRunDataToWorkspaceInput(data).regions).toEqual([]);
    expect(firstRunDataToWorkspaceInput(data).constraints).not.toContain('Готов к релокации');
    expect(firstRunDataToWorkspaceInput(data).constraints).toContain(
      'Сценарий Country Fit: Германия, годовая зарплата до налогов 60000 EUR',
    );
    expect(readCountryFitScenario()?.countryCode).toBe('DE');
  });
  it('keeps pending input while retrying and clears it at explicit persistence or logout boundary', () => {
    saveCountryFitScenario({ countryCode: 'DE', grossAnnualIncome: 60000, currency: 'EUR' });
    initialFirstRunData();
    initialFirstRunData();
    expect(readCountryFitScenario()?.grossAnnualIncome).toBe(60000);
    clearCountryFitScenario();
    expect(readCountryFitScenario()).toBeUndefined();
    expect(initialFirstRunData().context.countryFitScenario).toBeUndefined();
  });
  it('ignores corrupted storage', () => {
    sessionStorage.setItem(COUNTRY_FIT_STORAGE_KEY, '{');
    expect(readCountryFitScenario()).toBeUndefined();
    expect(initialFirstRunData().context.countryFitScenario).toBeUndefined();
  });
});

describe('confirmed local workspace transfer', () => {
  const scenario = { countryCode: 'DE' as const, grossAnnualIncome: 60000, currency: 'EUR' };
  it('keeps pending income for partial saves and recoverable write errors', () => {
    saveCountryFitScenario(scenario);
    saveWithCountryFitTransfer(() => undefined, 'Ещё уточняю план');
    expect(readCountryFitScenario()).toEqual(scenario);
    expect(() =>
      saveWithCountryFitTransfer(() => {
        throw new Error('quota');
      }, countryFitConstraint(scenario)),
    ).toThrow('quota');
    expect(readCountryFitScenario()).toEqual(scenario);
  });
  it('clears only after the matching scenario has been persisted', () => {
    saveCountryFitScenario(scenario);
    const constraints = countryFitConstraint(scenario);
    saveWithCountryFitTransfer(
      () => localStorage.setItem('b350-test-constraints', constraints),
      constraints,
    );
    expect(localStorage.getItem('b350-test-constraints')).toBe(constraints);
    expect(readCountryFitScenario()).toBeUndefined();
    localStorage.removeItem('b350-test-constraints');
  });
});
