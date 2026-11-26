import { describe, expect, it } from 'vitest';
import { blockingAdvisories } from './audit-gate.mjs';

const advisory = (id, severity) => ({
  source: 1,
  title: `title ${id}`,
  url: `https://github.com/advisories/${id}`,
  severity,
});

const report = {
  vulnerabilities: {
    picomatch: { severity: 'high', via: [advisory('GHSA-aaaa', 'high')] },
    vite: { severity: 'high', via: ['picomatch', 'tinyglobby'] },
    glob: { severity: 'moderate', via: [advisory('GHSA-bbbb', 'moderate')] },
  },
};

const exception = [{ id: 'GHSA-aaaa', until: '2026-12-17', reason: 'no patch' }];

describe('audit gate', () => {
  it('blocks a high advisory with no exception', () => {
    expect(blockingAdvisories(report, [], '2026-11-17').map((item) => item.id)).toEqual([
      'GHSA-aaaa',
    ]);
  });

  it('lets a listed advisory through until its date, dependents included', () => {
    expect(blockingAdvisories(report, exception, '2026-12-17')).toEqual([]);
  });

  it('blocks again the day after the exception ends', () => {
    expect(blockingAdvisories(report, exception, '2026-12-18')).toHaveLength(1);
  });

  it('still blocks a different high advisory in the same package', () => {
    const second = {
      vulnerabilities: {
        picomatch: {
          severity: 'critical',
          via: [advisory('GHSA-aaaa', 'high'), advisory('GHSA-cccc', 'critical')],
        },
      },
    };
    expect(blockingAdvisories(second, exception, '2026-11-17').map((item) => item.id)).toEqual([
      'GHSA-cccc',
    ]);
  });
});
