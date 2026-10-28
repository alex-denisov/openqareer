import { describe, expect, it } from 'vitest';
import type { VacancyFitResult, VacancyFitView } from './vacancyFit';
import {
  compareFitPercent,
  vacancyFitCeiling,
  vacancyFitPercent,
  vacancyFitTier,
} from './vacancyFitPercent';

function view(
  percent: number | null,
  total = 12,
  patch: Partial<VacancyFitResult> = {},
  state: VacancyFitView['state'] = 'ready',
): VacancyFitView {
  const gate = { status: 'matched', reason: '' } as const;
  return {
    state,
    requirements: [],
    result: {
      candidateId: 'c',
      vacancyId: 'v',
      algorithmVersion: 'evidence-coverage-3',
      status: 'assessed',
      calculatedAt: '2026-10-28T10:00:00Z',
      dataState: 'confirmed',
      gates: { role: gate, level: gate, region: gate, workAuthorization: gate, workFormat: gate },
      coveragePercent: percent,
      requiredCoverage: { matched: 0, total: 0, percent: null },
      coverage: { matched: 0, total, unknown: 0 },
      assessments: [],
      reason: 'assessed',
      ...patch,
    },
  };
}

describe('vacancyFitPercent: the one number the row, the block and the order show', () => {
  it('returns the computed percent', () => {
    expect(vacancyFitPercent(view(92))).toBe(92);
    expect(vacancyFitPercent(view(0))).toBe(0);
  });
  it('never shows a percent from fewer than 3 requirements', () => {
    expect(vacancyFitPercent(view(100, 1))).toBeNull();
    expect(vacancyFitPercent(view(100, 2))).toBeNull();
  });
  it('has no percent while computing or when the result is not assessed', () => {
    expect(vacancyFitPercent(view(80, 12, {}, 'processing'))).toBeNull();
    expect(vacancyFitPercent(view(80, 12, { status: 'blocked' }))).toBeNull();
    expect(vacancyFitPercent(undefined)).toBeNull();
  });
  it('keeps the previous percent while refreshing', () => {
    expect(vacancyFitPercent(view(73, 12, {}, 'refreshing'))).toBe(73);
  });
});

describe('vacancyFitTier', () => {
  it.each([
    [100, 'hi'],
    [80, 'hi'],
    [79, 'good'],
    [60, 'good'],
    [59, 'mid'],
    [40, 'mid'],
    [39, 'low'],
    [0, 'low'],
  ])('%i → %s', (percent, tier) => expect(vacancyFitTier(percent)).toBe(tier));
});

describe('vacancyFitCeiling: 10 points off per unconfirmed role, region or work permit', () => {
  it('is 100 when all key conditions are confirmed', () => {
    expect(vacancyFitCeiling(view(90).result!)).toBe(100);
  });
  it('drops by 10 for each unconfirmed key condition', () => {
    const unknown = { status: 'unknown', reason: '' } as const;
    const base = view(90).result!;
    expect(vacancyFitCeiling({ ...base, gates: { ...base.gates, region: unknown } })).toBe(90);
    expect(
      vacancyFitCeiling({
        ...base,
        gates: { ...base.gates, region: unknown, workAuthorization: unknown, workFormat: unknown },
      }),
    ).toBe(80);
  });
});

describe('compareFitPercent: by percent, descending; without a percent after all counted', () => {
  it('orders counted rows by percent and puts the rest last', () => {
    const rows = [
      { id: 'pending', v: view(null, 12, {}, 'processing') },
      { id: 'low', v: view(31) },
      { id: 'few', v: view(100, 1) },
      { id: 'high', v: view(92) },
      { id: 'mid', v: view(55) },
    ];
    const sorted = [...rows].sort((a, b) => compareFitPercent(a.v, b.v));
    expect(sorted.map((row) => row.id).slice(0, 3)).toEqual(['high', 'mid', 'low']);
    expect(
      sorted
        .slice(3)
        .map((row) => row.id)
        .sort(),
    ).toEqual(['few', 'pending']);
  });
});
