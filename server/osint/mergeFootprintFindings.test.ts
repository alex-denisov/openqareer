import { describe, expect, it } from 'vitest';
import type { CandidateFootprintFinding } from '../../shared/candidateFootprint';
import type { FootprintFinding } from './adapters/footprintAdapter';
import { mergeFootprintFindings } from './mergeFootprintFindings';

const profileFinding = (adapter: string, url: string): FootprintFinding => ({
  adapter,
  kind: 'profile',
  url,
  title: 'Public profile',
  detail: 'Profile matched by username.',
  match: 'likely_self',
  observedAt: '2026-10-04T12:00:00.000Z',
  receipt: { method: 'GET', source: adapter, query: 'username=public-handle' },
});

describe('mergeFootprintFindings', () => {
  it('merges duplicate URLs and keeps earlier sources, receipts and candidate decision', () => {
    const existing: CandidateFootprintFinding = {
      ...profileFinding('sherlock', 'https://portfolio.example/profile'),
      id: 'finding-1',
      sources: ['sherlock', 'maigret'],
      receipts: [
        profileFinding('sherlock', 'https://portfolio.example/profile').receipt,
        profileFinding('maigret', 'https://portfolio.example/profile').receipt,
      ],
      automatedMatch: 'likely_self',
      review: 'confirmed_self',
      match: 'confirmed_self',
    };

    const merged = mergeFootprintFindings(
      [profileFinding('wayback', 'https://portfolio.example/profile#contact')],
      [existing],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'finding-1',
      url: 'https://portfolio.example/profile',
      review: 'confirmed_self',
      sources: ['sherlock', 'maigret', 'wayback'],
    });
    expect(merged[0]?.receipts).toHaveLength(3);
  });

  it('keeps breach records distinct when they have no URL', () => {
    const records = mergeFootprintFindings([
      { ...profileFinding('hibp', ''), kind: 'breach', url: null, title: 'Breach A' },
      { ...profileFinding('hibp', ''), kind: 'breach', url: null, title: 'Breach B' },
    ], []);

    expect(records.map((record) => record.title)).toEqual(['Breach A', 'Breach B']);
  });

  it('uses the adapter match after a candidate clears an earlier decision', () => {
    const clearedDecision: CandidateFootprintFinding = {
      ...profileFinding('sherlock', 'https://portfolio.example/profile'),
      id: 'finding-cleared',
      sources: ['sherlock'],
      receipts: [profileFinding('sherlock', 'https://portfolio.example/profile').receipt],
      automatedMatch: 'likely_self',
      review: 'unreviewed',
      match: 'confirmed_self',
    };

    const merged = mergeFootprintFindings(
      [profileFinding('maigret', 'https://portfolio.example/profile')],
      [clearedDecision],
    );

    expect(merged[0]).toMatchObject({
      id: 'finding-cleared',
      review: 'unreviewed',
      automatedMatch: 'likely_self',
      match: 'likely_self',
      sources: ['sherlock', 'maigret'],
    });
  });
});
