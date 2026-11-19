import { describe, expect, it } from 'vitest';
import { RUSSIAN_CITIES, placeKey, placesSchema, russianCityRows } from './relocationPlaces';

describe('B672 relocation places', () => {
  it('knows Russian cities by catalog slug with their Russian names', () => {
    expect(RUSSIAN_CITIES.get('kazan')).toBe('Казань');
    expect(RUSSIAN_CITIES.get('saint-petersburg')).toBe('Санкт-Петербург');
    expect(RUSSIAN_CITIES.has('belgrade')).toBe(false);
  });

  it('accepts countries with a tax scale and Russian cities, with skipped sections', () => {
    const parsed = placesSchema.safeParse({
      places: [
        { kind: 'country', code: 'RS', skipped: ['education'] },
        { kind: 'city', slug: 'kazan', skipped: [] },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.places.map(placeKey)).toEqual(['country:RS', 'city:kazan']);
  });

  it('rejects an unknown country, a foreign city, a repeated place and an unknown section', () => {
    const bad = [
      [{ kind: 'country', code: 'FR', skipped: [] }],
      [{ kind: 'city', slug: 'belgrade', skipped: [] }],
      [
        { kind: 'city', slug: 'kazan', skipped: [] },
        { kind: 'city', slug: 'kazan', skipped: [] },
      ],
      [{ kind: 'country', code: 'RS', skipped: ['visa'] }],
    ];
    for (const places of bad) expect(placesSchema.safeParse({ places }).success).toBe(false);
  });

  it('caps the list at twelve places', () => {
    const cities = [...RUSSIAN_CITIES.keys()].map((slug) => ({ kind: 'city', slug, skipped: [] }));
    const countries = ['DE', 'CY', 'RS', 'AE', 'GE'].map((code) => ({
      kind: 'country',
      code,
      skipped: [],
    }));
    const places = [...countries, ...cities].slice(0, 13);
    expect(places).toHaveLength(13);
    expect(placesSchema.safeParse({ places }).success).toBe(false);
    expect(placesSchema.safeParse({ places: places.slice(0, 12) }).success).toBe(true);
  });

  it('lists Russian cities with vacancies, largest first, without empty ones', () => {
    const rows = russianCityRows([
      { slug: 'kazan', count: 63 },
      { slug: 'saint-petersburg', count: 214 },
      { slug: 'belgrade', count: 40 },
      { slug: 'moscow', count: 0 },
    ]);
    expect(rows).toEqual([
      { slug: 'saint-petersburg', name: 'Санкт-Петербург', vacancies: 214 },
      { slug: 'kazan', name: 'Казань', vacancies: 63 },
    ]);
  });
});
