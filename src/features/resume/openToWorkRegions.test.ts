import { describe, expect, it } from 'vitest';
import { mapOpenToWorkLocations } from './openToWorkRegions';

describe('mapOpenToWorkLocations', () => {
  it('maps a "city, country" LinkedIn location onto the candidate-region catalogue', () => {
    const { matched, unmatched } = mapOpenToWorkLocations(['Berlin, Germany']);
    expect(matched).toEqual(['eu']);
    expect(unmatched).toEqual([]);
  });

  it('keeps a Cyrillic city name the same dictionary already recognises', () => {
    const { matched, unmatched } = mapOpenToWorkLocations(['Берлин']);
    expect(matched).toEqual(['eu']);
    expect(unmatched).toEqual([]);
  });

  it('never drops a location the dictionary does not recognise — it comes back unmatched', () => {
    const { matched, unmatched } = mapOpenToWorkLocations(['Remote (EU)']);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual(['Remote (EU)']);
  });

  it('deduplicates and orders matches by the catalogue, not input order', () => {
    const { matched } = mapOpenToWorkLocations(['Moscow', 'Berlin, Germany', 'Russia']);
    expect(matched).toEqual(['ru', 'eu']);
  });

  it('ignores blank entries without producing an empty unmatched string', () => {
    const { matched, unmatched } = mapOpenToWorkLocations(['', '  ']);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([]);
  });
});
