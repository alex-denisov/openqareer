import { describe, expect, it } from 'vitest';
import { responseLetterTarget } from './responseLetterTarget';
import type { ApplicationView } from './applicationsApi';

const app = (overrides: Partial<ApplicationView>) =>
  ({
    id: 'a1',
    clusterId: 'cl1',
    vacancy: { title: 'VP of Operations', company: 'Firstrade', url: 'https://jobs/1', source: 'indeed' },
    ...overrides,
  }) as ApplicationView;

describe('responseLetterTarget (B631)', () => {
  it('builds the letter target from the response vacancy', () => {
    expect(responseLetterTarget(app({}))).toEqual({
      id: 'cl1',
      canonicalTitle: 'VP of Operations',
      canonicalCompany: 'Firstrade',
      sources: [{ sourceName: 'indeed' }],
      descriptionSummary: '',
      primaryUrl: 'https://jobs/1',
    });
  });

  it('has no target for a manual card without a vacancy', () => {
    expect(responseLetterTarget(app({ clusterId: null }))).toBeNull();
  });
});
