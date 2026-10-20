import { describe, expect, it } from 'vitest';
import { countryCodeOf } from './geoCoordinates';

describe('countryCodeOf', () => {
  it('reads the country from the location text', () => {
    expect(countryCodeOf('San Francisco, USA')).toBe('US');
    expect(countryCodeOf('Remote (United States | Canada)')).toBe('CA');
    expect(countryCodeOf('Москва, Россия')).toBe('RU');
    expect(countryCodeOf('Новосибирск')).toBe('RU');
    expect(countryCodeOf('Abu Dhabi')).toBe('AE');
  });

  it('gives up on unknown or ambiguous places', () => {
    expect(countryCodeOf(undefined)).toBeUndefined();
    expect(countryCodeOf('Удалённо')).toBeUndefined();
  });
});
