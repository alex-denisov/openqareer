import { describe, expect, it } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { listRelocationCountries } from './relocationCountryData';
import {
  relocationTabCounts,
  sortRelocationCountries,
  summarizeRelocationCountry,
  visibleRelocationCountries,
} from './relocationCountrySummary';

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

  it('never leads a card with a scenario the candidate cannot use (Spain is not EAEU for a Russian)', () => {
    for (const country of listRelocationCountries()) {
      const summary = summarizeRelocationCountry(country, russianProfile());
      const lead = summary.scenarios.find(
        ({ id }) =>
          summary.scenarioLabel ===
          ({ simple_mobility: 'Без визы, ЕАЭС' } as Record<string, string>)[id],
      );
      const usable = summary.scenarios.some(({ status }) => status !== 'unavailable');
      if (lead && usable) expect(lead.status, country.countryCode).not.toBe('unavailable');
    }
    const spain = listRelocationCountries().find(({ countryCode }) => countryCode === 'ES');
    if (!spain) throw new Error('catalog lost Spain');
    expect(summarizeRelocationCountry(spain, russianProfile()).scenarioLabel).not.toBe(
      'Без визы, ЕАЭС',
    );
  });

  it('keeps unknown status honest when citizenship is missing', () => {
    const germany = listRelocationCountries().find(({ countryCode }) => countryCode === 'DE');
    if (!germany) throw new Error('catalog lost Germany');
    const summary = summarizeRelocationCountry(germany, emptyRelocationQuestionnaire());
    expect(summary.statusLabel).toBe('Нужно уточнить');
  });
});

describe('relocation country order', () => {
  it('puts open countries first, then barriers, then unknown', () => {
    const order = sortRelocationCountries(listRelocationCountries(), russianProfile()).map(
      (country) => summarizeRelocationCountry(country, russianProfile()).status,
    );
    const rank = { available: 0, high_barriers: 1, legally_unavailable: 2, unknown: 3 } as const;
    const ranks = order.map((status) => rank[status]);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
    expect(order[0]).toBe('available');
  });
});

describe('relocation tab counters', () => {
  it('counts the candidate list and the comparison selection, not literals', () => {
    const countries = listRelocationCountries();
    expect(relocationTabCounts(countries, [])).toEqual({
      countries: countries.length,
      comparison: 0,
    });
    expect(relocationTabCounts(countries.slice(0, 4), ['DE', 'AE'])).toEqual({
      countries: 4,
      comparison: 2,
    });
  });

  it('pins added countries into the visible preview', () => {
    const countries = listRelocationCountries();
    const last = countries.at(-1);
    if (!last) throw new Error('empty catalog');
    const visible = visibleRelocationCountries(countries, 3, [last.countryCode]);
    expect(visible.map(({ countryCode }) => countryCode)).toContain(last.countryCode);
    expect(visible).toHaveLength(4);
  });

  it('names a dated rules source for every country in the catalog, Kyrgyzstan included (28.10)', () => {
    const profile = {
      ...emptyRelocationQuestionnaire(),
      citizenshipDocuments: { citizenshipCountryCodes: ['RU'], documents: [] },
    };
    // США, Канада и Сингапур правил в каталоге пока не имеют: источника нет, и его не выдумываем.
    const withRules = listRelocationCountries().filter(({ mobility }) =>
      mobility.scenarios.some(
        ({ id, dataStatus }) => id !== 'domestic_market' && dataStatus !== 'no_data',
      ),
    );
    const missing = withRules
      .map((country) => summarizeRelocationCountry(country, profile))
      .filter(({ source }) => !source?.retrievedAt)
      .map(({ countryCode }) => countryCode);
    expect(missing).toEqual([]);
  });
});
