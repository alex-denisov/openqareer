import { describe, expect, it } from 'vitest';
import { toLinkedInContactsSummary } from './linkedinContactsSummary';

describe('LinkedIn contacts summary for the manage dialog (29.10)', () => {
  it('reports the last import', () => {
    expect(
      toLinkedInContactsSummary({
        linkedinImport: {
          state: 'imported',
          importedAt: '2026-10-29T14:00:00.000Z',
          importedCount: 1888,
        },
      }),
    ).toEqual({ importedCount: 1888, importedAt: '2026-10-29T14:00:00.000Z' });
  });

  it('is null before the first read', () => {
    expect(
      toLinkedInContactsSummary({
        linkedinImport: { state: 'unknown', importedAt: null, importedCount: null },
      }),
    ).toBeNull();
  });
});
