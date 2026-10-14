import { describe, expect, it } from 'vitest';
import { isContactImportStale } from './companiesAndPeopleUtils';

const REFERENCE_NOW = Date.parse('2026-10-14T10:00:00.000Z');

describe('isContactImportStale', () => {
  it('marks an import older than fourteen days as stale', () => {
    expect(isContactImportStale('2026-09-12T10:00:00.000Z', REFERENCE_NOW)).toBe(true);
  });

  it('keeps a fourteen-day-old import current and ignores unknown dates', () => {
    expect(isContactImportStale('2026-09-30T10:00:00.000Z', REFERENCE_NOW)).toBe(false);
    expect(isContactImportStale(null, REFERENCE_NOW)).toBe(false);
    expect(isContactImportStale('bad date', REFERENCE_NOW)).toBe(false);
  });
});
