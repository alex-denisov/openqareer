import { describe, expect, it } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { listRelocationCountries } from './relocationCountryData';
import { relocationTabCounts, summarizeRelocationCountry, visibleRelocationCountries } from './relocationCountrySummary';

function russianProfile() {
  const profile = emptyRelocationQuestionnaire();
  return {
    ...profile,
    citizenshipDocuments: { ...profile.citizenshipDocuments, citizenshipCountryCodes: ['RU'] },
  };
}

describe('relocation country summary', () => {
  it('reads the leading scenario, status and dated source from the mobility catalog', () => {
    const russia = listRelocationCountries().find(({ countryCode }) => countryCode === 'RU');
    if (!russia) throw new Error('catalog lost Russia');
    const summary = summarizeRelocationCountry(russia, russianProfile());
    expect(summary.status).toBe('available');
    expect(summary.statusLabel).toBe('Доступно без ограничений');
    expect(summary.scenarioLabel).toBeTruthy();
  });

  it('cites the dated rule source of a foreign country', () => {
    const germany = listRelocationCountries().find(({ countryCode }) => countryCode === 'DE');
    if (!germany) throw new Error('catalog lost Germany');
    const summary = summarizeRelocationCountry(germany, russianProfile());
    expect(summary.scenarioLabel).toBe('Переезд с визой');
    expect(summary.statusLabel).toBe('Высокие барьеры');
    expect(summary.source?.retrievedAt).toMatch(/\d/u);
  });

  it('keeps unknown status honest when citizenship is missing', () => {
    const germany = listRelocationCountries().find(({ countryCode }) => countryCode === 'DE');
    if (!germany) throw new Error('catalog lost Germany');
    const summary = summarizeRelocationCountry(germany, emptyRelocationQuestionnaire());
    expect(summary.statusLabel).toBe('Нужно уточнить');
  });
});

describe('relocation tab counters', () => {
  it('counts the candidate list and the comparison selection, not literals', () => {
    const countries = listRelocationCountries();
    expect(relocationTabCounts(countries, [])).toEqual({ countries: countries.length, comparison: 0 });
    expect(relocationTabCounts(countries.slice(0, 4), ['DE', 'AE'])).toEqual({ countries: 4, comparison: 2 });
  });

  it('pins added countries into the visible preview', () => {
    const countries = listRelocationCountries();
    const last = countries.at(-1);
    if (!last) throw new Error('empty catalog');
    const visible = visibleRelocationCountries(countries, 3, [last.countryCode]);
    expect(visible.map(({ countryCode }) => countryCode)).toContain(last.countryCode);
    expect(visible).toHaveLength(4);
  });
});
