import { describe, expect, it } from 'vitest';
import { northAmericanCountryOf, stripPostalCode } from './postalPlace';

describe('postal codes in place names (A9, B546)', () => {
  it('strips postal codes after and before the city name', () => {
    expect(stripPostalCode('Singapore 069542')).toBe('Singapore');
    expect(stripPostalCode('London EC1V 8AB')).toBe('London');
    expect(stripPostalCode('London EC1M')).toBe('London');
    expect(stripPostalCode('Tokyo 100-6324')).toBe('Tokyo');
    expect(stripPostalCode('〒100-6324 東京都 千代田区')).toBe('東京都 千代田区');
    expect(stripPostalCode('Berlin 10115')).toBe('Berlin');
  });

  it('keeps names that only look like codes', () => {
    expect(stripPostalCode('Baden-Baden')).toBe('Baden-Baden');
    expect(stripPostalCode('New York')).toBe('New York');
    expect(stripPostalCode('Winston-Salem')).toBe('Winston-Salem');
    expect(stripPostalCode('069542')).toBe('069542');
  });

  it('reads US states and Canadian provinces, not ISO countries', () => {
    expect(northAmericanCountryOf('IL')).toBe('United States');
    expect(northAmericanCountryOf('HI 96813')).toBe('United States');
    expect(northAmericanCountryOf('ON L4W 5J1')).toBe('Canada');
    expect(northAmericanCountryOf('ON')).toBe('Canada');
    expect(northAmericanCountryOf('Israel')).toBeUndefined();
    expect(northAmericanCountryOf('GB')).toBeUndefined();
    expect(northAmericanCountryOf('IL 1234')).toBeUndefined();
  });
});
