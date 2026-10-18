import { describe, expect, it } from 'vitest';
import { computeProposalKey, consultantProposalKey } from './consultantProposalKey';

describe('computeProposalKey', () => {
  it('returns stable deterministic key based on section and trimmed text', () => {
    const key1 = computeProposalKey('headline', 'Engineering Lead');
    const key2 = computeProposalKey('headline', 'Engineering Lead  ');
    expect(key1).toBe(key2);
    expect(key1.startsWith('headline:')).toBe(true);
  });

  it('differentiates distinct texts or sections', () => {
    const keyA = computeProposalKey('headline', 'Engineering Lead');
    const keyB = computeProposalKey('about', 'Engineering Lead');
    const keyC = computeProposalKey('headline', 'Product Director');

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });

  it('adds an explicit date field without changing legacy fieldless proposal keys', () => {
    const legacy = consultantProposalKey({
      resumeRevision: { section: 'experience', proposedText: '2021-01' },
    });
    expect(legacy).toBe(computeProposalKey('experience', '2021-01'));

    const startDate = consultantProposalKey({
      resumeRevision: { section: 'experience', field: 'startDate', proposedText: '2021-01' },
    });
    const endDate = consultantProposalKey({
      resumeRevision: { section: 'experience', field: 'endDate', proposedText: '2021-01' },
    });
    expect(startDate).not.toBe(legacy);
    expect(endDate).not.toBe(legacy);
    expect(startDate).not.toBe(endDate);
  });
});
