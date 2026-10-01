import { describe, expect, it } from 'vitest';
import { computeProposalKey } from './consultantProposalKey';

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
});
