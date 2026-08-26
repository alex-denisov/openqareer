import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_REGIONS,
  candidateRegionLabels,
  isCandidateRegion,
  normalizeCandidateRegions,
  regionsFromLegacyMarket,
} from './candidateRegions';

describe('candidate regions replace the binary market', () => {
  it('offers the regions the owner named and nothing pretending to be one', () => {
    expect([...CANDIDATE_REGIONS]).toEqual([
      'ru',
      'cis',
      'us',
      'eu',
      'mena',
      'apac',
      'latam',
    ]);
    expect(isCandidateRegion('international')).toBe(false);
    expect(isCandidateRegion('eu')).toBe(true);
  });

  it('keeps a stored list in catalogue order without duplicates or invented members', () => {
    expect(
      normalizeCandidateRegions(['latam', 'us', 'ru', 'us', 'atlantis']),
    ).toEqual(['ru', 'us', 'latam']);
  });

  it('migrates the legacy answer without inventing a region the candidate never named', () => {
    // 'ru' names exactly one region; 'international' names none, so expanding
    // it into a region set would put words in the candidate's mouth.
    expect(regionsFromLegacyMarket('ru')).toEqual(['ru']);
    expect(regionsFromLegacyMarket('international')).toEqual([]);
    expect(regionsFromLegacyMarket(undefined)).toEqual([]);
  });

  it('says the regions in the candidate’s own language', () => {
    expect(candidateRegionLabels(['ru', 'eu', 'cis', 'apac'])).toEqual([
      'Россия',
      'СНГ',
      'EU',
      'APAC',
    ]);
    expect(candidateRegionLabels([])).toEqual([]);
  });
});
