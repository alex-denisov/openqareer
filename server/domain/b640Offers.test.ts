import { describe, expect, it } from 'vitest';
import {
  buildOfferView,
  netFromGross,
  offerDeadline,
  summarizeResponses,
} from './b640Offers';

const NOW = new Date('2026-11-19T15:00:00Z');

describe('netFromGross', () => {
  it('rounds amount x (1 - tax/100)', () => {
    expect(netFromGross(200000, 13)).toBe(174000);
    expect(netFromGross(100001, 13)).toBe(87001);
    expect(netFromGross(100000, 0)).toBe(100000);
  });
  it('is null without amount or tax', () => {
    expect(netFromGross(null, 13)).toBeNull();
    expect(netFromGross(1000, null)).toBeNull();
  });
});

describe('offerDeadline', () => {
  it('counts UTC calendar days', () => {
    expect(offerDeadline('2026-11-18', NOW)).toEqual({ daysLeft: -1, deadline: 'overdue' });
    expect(offerDeadline('2026-11-19', NOW)).toEqual({ daysLeft: 0, deadline: 'today' });
    expect(offerDeadline('2026-11-21', NOW)).toEqual({ daysLeft: 2, deadline: 'soon' });
    expect(offerDeadline('2026-11-22T10:00:00Z', NOW)).toEqual({ daysLeft: 3, deadline: 'later' });
  });
  it('is empty without a date or with garbage', () => {
    expect(offerDeadline(null, NOW)).toEqual({ daysLeft: null, deadline: null });
    expect(offerDeadline('soon', NOW)).toEqual({ daysLeft: null, deadline: null });
  });
});

describe('buildOfferView', () => {
  it('assembles gross, net, deadline and decision', () => {
    const view = buildOfferView({
      applicationId: 'a1',
      terms: { baseSalary: 300000, salaryPeriod: 'month', currency: 'RUB' },
      respondBy: '2026-11-20',
      choice: { taxPercent: 13, decision: 'accepted', decidedAt: '2026-11-19T10:00:00Z' },
      now: NOW,
    });
    expect(view).toEqual({
      applicationId: 'a1',
      gross: { amount: 300000, period: 'month', currency: 'RUB' },
      taxPercent: 13,
      net: 261000,
      respondBy: '2026-11-20',
      daysLeft: 1,
      deadline: 'soon',
      decision: 'accepted',
      decidedAt: '2026-11-19T10:00:00Z',
    });
  });
  it('is all null without choice and salary', () => {
    const view = buildOfferView({ applicationId: 'a2', terms: {}, respondBy: null, choice: null, now: NOW });
    expect(view).toMatchObject({
      gross: { amount: null, period: null, currency: null },
      taxPercent: null, net: null, daysLeft: null, deadline: null, decision: null, decidedAt: null,
    });
  });
});

describe('summarizeResponses', () => {
  it('splits current stages into auto and manual', () => {
    const summary = summarizeResponses(
      [
        { id: 'a', stage: 'applied' },
        { id: 'b', stage: 'applied' },
        { id: 'c', stage: 'offer' },
      ],
      new Set(['a', 'zzz']),
    );
    expect(summary.counts.all.applied).toBe(2);
    expect(summary.counts.auto.applied).toBe(1);
    expect(summary.counts.manual.applied).toBe(1);
    expect(summary.counts.manual.offer).toBe(1);
    expect(summary.counts.auto.offer).toBe(0);
    expect(summary.autoApplicationIds).toEqual(['a']);
  });
});
