import { describe, expect, it } from 'vitest';
import { bundledCities } from './bundledCities';
import { createCities } from './cityCountry';

const { country: cityCountry, inText: cityCountryInText } = createCities(bundledCities());

describe('cityCountry', () => {
  it.each([
    ['Redwood City', 'US'],
    ['Friedrichshafen', 'DE'],
    ['Milano', 'IT'],
    ['München', 'DE'],
  ])('%s', (city, country) => expect(cityCountry(city)).toBe(country));

  it('does not guess a namesake, a short word or an object key', () => {
    expect(cityCountry('constructor')).toBeUndefined();
    expect(cityCountry('Cambridge')).toBeUndefined();
    expect(cityCountry('Remote')).toBeUndefined();
  });

  it('finds the city inside a longer place', () => {
    expect(cityCountryInText('Friedrichshafen Werk 2')).toBe('DE');
    expect(cityCountryInText('Friedrichshafen, Milano')).toBeUndefined();
    expect(cityCountryInText('3 Locations')).toBeUndefined();
  });
});
