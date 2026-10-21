import { describe, expect, it } from 'vitest';
import { savedVacancyStates, type SavedVacancyStateSource } from './savedVacancyStates';

function source(): SavedVacancyStateSource {
  const active = new Map([
    [
      'open-1',
      { status: 'active' as const, salary: { from: 450_000, to: 600_000, currency: 'RUR' } },
    ],
    ['dead-1', { status: 'active' as const, linkStatus: 'gone' as const }],
  ]);
  return {
    getActiveCluster: (id) => active.get(id),
    isKnownVacancyGone: (id) => id === 'cluster-gone-1',
    getVacancy: (id) => (id === 'gone-1' ? { archivedAt: '2026-10-06T09:00:00.000Z' } : undefined),
  };
}

describe('savedVacancyStates', () => {
  it('returns salary for an open vacancy and marks a dead link closed', () => {
    const states = savedVacancyStates(source(), ['open-1', 'dead-1']);
    expect(states['open-1']).toEqual({
      closed: false,
      salary: { from: 450_000, to: 600_000, currency: 'RUR' },
    });
    expect(states['dead-1']).toEqual({ closed: true });
  });

  it('marks a known removed vacancy closed with its archive date', () => {
    expect(savedVacancyStates(source(), ['cluster-gone-1'])['cluster-gone-1']).toEqual({
      closed: true,
      closedAt: '2026-10-06T09:00:00.000Z',
    });
  });

  it('leaves unknown vacancies out instead of guessing', () => {
    expect(savedVacancyStates(source(), ['nobody'])).toEqual({});
  });
});
