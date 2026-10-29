import { describe, expect, it } from 'vitest';
import type { VacancyFitResult, VacancyFitView } from './vacancyFit';
import {
  compareFitPercent,
  vacancyFitPercent,
  vacancyFitStage,
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

describe('compareFitPercent: the CPO order of 28.10 evening', () => {
  it('40 %+ by percent, then counting rows, then counted below 40 %, then rows that cannot be counted', () => {
    const rows = [
      { id: 'blocked', v: view(null, 12, { status: 'blocked', reason: 'blocked_gate' }) },
      { id: 'low', v: view(31) },
      { id: 'pending', v: view(null, 12, {}, 'processing') },
      { id: 'unseen', v: undefined },
      { id: 'few', v: view(100, 1) },
      { id: 'high', v: view(92) },
      { id: 'zero', v: view(0) },
      { id: 'edge', v: view(40) },
      { id: 'empty', v: { state: 'no_description', requirements: [] } as VacancyFitView },
    ];
    const sorted = [...rows].sort((a, b) => compareFitPercent(a.v, b.v));
    const ids = sorted.map((row) => row.id);
    expect(ids.slice(0, 2)).toEqual(['high', 'edge']);
    expect(ids.slice(2, 4).sort()).toEqual(['pending', 'unseen']);
    expect(ids.slice(4, 6)).toEqual(['low', 'zero']);
    expect(ids.slice(6).sort()).toEqual(['blocked', 'empty', 'few']);
  });

  it('names the same stage the row shows', () => {
    expect(vacancyFitStage(view(92))).toBe('counted');
    expect(vacancyFitStage(view(12))).toBe('counted_low');
    expect(vacancyFitStage(undefined)).toBe('counting');
    expect(vacancyFitStage(view(null, 12, {}, 'refreshing'))).toBe('counting');
    // 29.10: a failed count is re-queued on show and reads «считаем».
    expect(vacancyFitStage({ state: 'failed', requirements: [] })).toBe('counting');
    expect(vacancyFitStage({ state: 'no_requirements', requirements: [] })).toBe('none');
  });
});
