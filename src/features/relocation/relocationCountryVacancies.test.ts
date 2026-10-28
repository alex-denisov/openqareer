import { beforeAll, describe, expect, it } from 'vitest';
import { loadGeoDirectory } from '../../../shared/geo/geoDirectory';
import { visibleFact } from '../../../shared/countryFit/countryComparison';
import {
  countryVacancyCount,
  countryVacancyFact,
  vacancyCountLabel,
} from './relocationCountryVacancies';

const sample = {
  total: 100,
  capturedAt: '2026-10-26',
  places: [
    { location: 'Berlin', country: 'Germany', count: 7 },
    { location: 'Мюнхен', country: 'Германия', count: 3 },
    { location: 'Hamburg, Germany', count: 2 },
    { location: 'Москва', country: 'Россия', count: 80 },
  ],
};

describe('country vacancies from the matched pool', () => {
  beforeAll(() => loadGeoDirectory());

  it('counts places by ISO, Russian and English country names', () => {
    expect(countryVacancyCount(sample, 'DE')).toBe(12);
    expect(countryVacancyCount(sample, 'RU')).toBe(80);
    expect(countryVacancyCount(sample, 'PT')).toBe(0);
  });

  it('counts the prod pool shape: a city with the campaign region and no country (OWNER_TEST, 28.10)', () => {
    const pool = {
      total: 145,
      capturedAt: '2026-10-28',
      places: [
        { location: 'Москва', isRemote: true, region: 'ru' as const, count: 44 },
        { location: 'Москва', region: 'ru' as const, count: 57 },
        { location: 'Славгород (Алтайский край)', region: 'ru' as const, count: 1 },
        { location: 'Белград', count: 4 },
        { location: 'Remote', isRemote: true, count: 3 },
      ],
    };
    expect(countryVacancyCount(pool, 'RU')).toBe(102);
    expect(countryVacancyCount(pool, 'RS')).toBe(4);
    expect(countryVacancyCount(pool, 'DE')).toBe(0);
  });

  it('keeps the pool count visible in the comparison: the pool has no URL, only a dated sample', () => {
    expect(visibleFact(countryVacancyFact(sample, 'DE'), 'relocationVacancies')).toMatchObject({
      status: 'available',
      value: { count: 12 },
    });
  });

  it('builds a dated fact out of the pool size, or no fact without a pool', () => {
    const fact = countryVacancyFact(sample, 'DE');
    expect(fact.status).toBe('available');
    if (fact.status === 'available')
      expect(fact.value).toMatchObject({ count: 12, sampleSize: 100 });
    expect(countryVacancyFact(null, 'DE').status).toBe('no_data');
  });

  it('declines the word', () => {
    expect(vacancyCountLabel(1)).toBe('1 вакансия');
    expect(vacancyCountLabel(3)).toBe('3 вакансии');
    expect(vacancyCountLabel(12)).toBe('12 вакансий');
    expect(vacancyCountLabel(31)).toBe('31 вакансия');
  });
});
