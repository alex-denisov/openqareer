import { describe, expect, it } from 'vitest';
import { calculateAnnualPayroll } from '../taxCalculators';
import {
  RELOCATION_EXAMPLE,
  estimateRelocation,
  estimateRelocationCountry,
  grossForNetMonthly,
  relocationMoney,
} from './relocationEstimate';

const COUNTRY_CODES_FOR_TEST = [
  'DE',
  'CY',
  'RS',
  'AE',
  'GE',
  'RU',
  'AM',
  'KZ',
  'TR',
  'UZ',
  'BY',
  'ME',
  'GB',
] as const;

describe('relocation estimate (B354)', () => {
  it('example gives three different countries, one card each', () => {
    const cards = estimateRelocation(RELOCATION_EXAMPLE);
    expect(cards.map(({ countryCode }) => countryCode).sort()).toEqual(['AE', 'DE', 'GE']);
  });

  it('gross for net inverts the payroll calculator', () => {
    const gross = grossForNetMonthly('DE', 5_000);
    expect(gross).not.toBeNull();
    const net = calculateAnnualPayroll('DE', (gross ?? 0) * 12).netMonthlyIncome;
    expect(Math.abs(net - 5_000)).toBeLessThan(2);
  });

  it('no income tax in the UAE, other currency is honest', () => {
    expect(relocationMoney('AE', 5_000, 'EUR').kind).toBe('no_income_tax');
    expect(relocationMoney('RS', 5_000, 'EUR')).toEqual({
      kind: 'other_currency',
      currency: 'RSD',
    });
  });

  it.each(COUNTRY_CODES_FOR_TEST)('%s answers with a source', (code) => {
    const card = estimateRelocationCountry(code, {
      ...RELOCATION_EXAMPLE,
      citizenship: 'other',
      countries: [code],
    });
    expect(card.sources.length).toBeGreaterThan(0);
    for (const source of card.sources) {
      expect(source.url).toMatch(/^https?:\/\//u);
      expect(source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    }
    if (card.kind === 'path') expect(card.requirements.length).toBeGreaterThan(0);
    else expect(card.reason).toBeTruthy();
  });

  it('citizen of the country gets the domestic path', () => {
    const card = estimateRelocationCountry('RU', { ...RELOCATION_EXAMPLE, countries: ['RU'] });
    expect(card.scenarioId).toBe('domestic_market');
  });

  it('IT without a degree sees the Blue Card IT path in Germany', () => {
    const card = estimateRelocationCountry('DE', RELOCATION_EXAMPLE);
    expect(card.kind).toBe('path');
    expect(card.requirements.every(({ mark }) => mark !== 'barrier')).toBe(true);
  });
});
