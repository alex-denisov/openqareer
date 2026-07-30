import { describe, expect, it } from 'vitest';
import {
  analyzeGhostJobRisk,
  getAggregateGhostSentinelStatus,
} from '../ghostDetector';

describe('analyzeGhostJobRisk', () => {
  it('covers low, medium and high branches with synthetic observations', () => {
    const low = analyzeGhostJobRisk('low', 'Role', 'Company', 2, false);
    const medium = analyzeGhostJobRisk('medium', 'Role', 'Company', 40, false);
    const high = analyzeGhostJobRisk('high', 'Role', 'Company', 40, true);

    expect(low.riskLevel).toBe('Low');
    expect(medium.riskLevel).toBe('Medium');
    expect(high.riskLevel).toBe('High');
    expect(high.inactivityFlags).toHaveLength(2);
    expect(high.responseRatePercent).toBe(15);
  });

  it('handles default parameters without throwing', () => {
    const result = analyzeGhostJobRisk('default', 'Role', 'Company');

    expect(result.riskScore).toBeLessThanOrEqual(98);
    expect(result.repostCount).toBe(4);
  });
});

describe('getAggregateGhostSentinelStatus', () => {
  it('aggregates a fixed synthetic list', () => {
    const result = getAggregateGhostSentinelStatus([
      { id: '1', title: 'Role one', sub: 'Company one' },
      { id: '2', title: 'Role two', sub: 'Company two' },
    ]);

    expect(result.totalAnalyzed).toBe(2);
    expect(result.highRiskCount).toBe(1);
    expect(result.sentinelStatus).toBe('Alert Triggered');
    expect(result.alerts[0]?.jobId).toBe('1');
  });

  it('returns a quiet state for an empty list', () => {
    const result = getAggregateGhostSentinelStatus([]);

    expect(result).toMatchObject({
      totalAnalyzed: 0,
      highRiskCount: 0,
      mediumRiskCount: 0,
      sentinelStatus: 'Active & Scanning',
      alerts: [],
    });
  });
});

