import { describe, expect, it } from 'vitest';
import { careerGeographyOf } from '../vacancies/careerGeography';
import { placeCoveredBySearch } from './vacancyFitContext';

// adenisov.test on prod 03.11: the profile city is Dubai, the search conditions name these places.
const owner = careerGeographyOf({ searchLocations: ['Москва', 'Удалённо из РФ', 'ОАЭ'] });

describe('placeCoveredBySearch (03.11)', () => {
  it('a Moscow office is covered by «Москва» whatever the profile city', () => {
    expect(placeCoveredBySearch(owner, { location: 'Москва', isRemote: false })).toBe(true);
  });

  it('a Dubai office is covered by «ОАЭ», a remote job by a remote scope', () => {
    expect(placeCoveredBySearch(owner, { location: 'Dubai, United Arab Emirates', isRemote: false })).toBe(true);
    expect(placeCoveredBySearch(owner, { location: 'Berlin, Germany', isRemote: true })).toBe(true);
  });

  it('an office outside the places is not covered', () => {
    expect(placeCoveredBySearch(owner, { location: 'Berlin, Germany', isRemote: false })).toBe(false);
  });

  it('remote scopes alone are conditions too: a remote job is covered, an office is not', () => {
    const remote = careerGeographyOf({ searchLocations: ['Удалённо'] });
    expect(placeCoveredBySearch(remote, { location: 'Москва', isRemote: true })).toBe(true);
    expect(placeCoveredBySearch(remote, { location: 'Москва', isRemote: false })).toBe(false);
  });

  it('no places in the conditions: no verdict, the profile city stays the fallback', () => {
    expect(placeCoveredBySearch(null, { location: 'Москва', isRemote: false })).toBeUndefined();
    expect(placeCoveredBySearch(careerGeographyOf({ searchLocations: [] }), { location: 'Москва', isRemote: false })).toBeUndefined();
  });
});
