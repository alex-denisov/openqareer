import { describe, expect, it } from 'vitest';
import { isAtsBoardSourceId } from './atsSourceId';
import { confirmsLiveness } from './poolLiveness';
import { getSourcePriority } from './vacancyDeduplicator';

describe('B641 · доски ATS из freehire ведут себя как ats-*', () => {
  it('recognises ATS boards by provider, not by where they were found', () => {
    expect(isAtsBoardSourceId('ats-greenhouse-stripe')).toBe(true);
    expect(isAtsBoardSourceId('src-fh-icims-careers-hilton')).toBe(true);
    expect(isAtsBoardSourceId('src-fh-jobvite-odawa')).toBe(true);
    expect(isAtsBoardSourceId('src-fh-oracle-efet-cx-1')).toBe(true);
    expect(isAtsBoardSourceId('src-fh-yandex')).toBe(false);
    expect(isAtsBoardSourceId('src-hh')).toBe(false);
  });

  it('gives an iCIMS board the same liveness and dedupe priority as an ats-* board', () => {
    expect(confirmsLiveness('src-fh-icims-careers-hilton')).toBe(
      confirmsLiveness('ats-greenhouse-stripe'),
    );
    const provenance = (sourceId: string) => ({
      sourceType: 'json_api' as const,
      sourceId,
      sourceUrl: 'https://example.test/job/1',
      observedAt: '2026-11-10T00:00:00.000Z',
    });
    expect(getSourcePriority(provenance('src-fh-icims-careers-hilton'))).toBe(
      getSourcePriority(provenance('ats-greenhouse-stripe')),
    );
  });
});
