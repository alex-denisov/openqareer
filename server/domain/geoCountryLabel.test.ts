import { describe, expect, it } from 'vitest';
import { isKnownCountry } from './geoCoordinates';

/**
 * B203 — «Alma · Italy» приезжала на карту городом-хабом «Italy». Страна в поле
 * города раздувает счёт хабов: 46 «городов» на проде включали страны.
 */
describe('страна отличается от города', () => {
  it('узнаёт страну по её названию', () => {
    expect(isKnownCountry('Italy')).toBe(true);
    expect(isKnownCountry('  germany ')).toBe(true);
  });

  it('город страной не считает', () => {
    expect(isKnownCountry('Berlin')).toBe(false);
    expect(isKnownCountry('San Francisco')).toBe(false);
    expect(isKnownCountry('')).toBe(false);
  });
});
