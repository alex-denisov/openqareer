import { describe, expect, it } from 'vitest';
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
  it('counts places by ISO, Russian and English country names', () => {
    expect(countryVacancyCount(sample, 'DE')).toBe(12);
    expect(countryVacancyCount(sample, 'RU')).toBe(80);
    expect(countryVacancyCount(sample, 'PT')).toBe(0);
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
