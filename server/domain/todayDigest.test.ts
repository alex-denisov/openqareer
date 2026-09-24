import { describe, expect, it } from 'vitest';
import { buildTodaySnapshot } from './todayDigest';
import type { ApplicationView } from './applicationDerivedFields';

function application(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: 'app-1',
    candidateId: 'cand-1',
    clusterId: 'cluster-1',
    stage: 'applied',
    closedReason: null,
    processProfile: 'standard',
    vacancy: { title: 'Продуктовый аналитик', company: 'FinCloud', url: '', source: '' },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-09-20T00:00:00.000Z',
    version: 1,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    followUp: null,
    whoseTurn: 'candidate',
    materials: { coverLetter: false, resume: false },
    nearestInterview: null,
    ...overrides,
  };
}

describe('buildTodaySnapshot (B251, S4, architecture.md §57)', () => {
  it('collects applications waiting on the candidate into the queue', () => {
    const snapshot = buildTodaySnapshot({
      applications: [application(), application({ id: 'app-2', whoseTurn: 'company' })],
      newVacancies: [],
      sinceLastVisit: '2026-09-23T10:00:00.000Z',
      closedVacanciesSinceVisit: 0,
    });

    expect(snapshot.digest.waitingForYou).toBe(1);
    expect(snapshot.queue).toHaveLength(1);
    expect(snapshot.queue[0].kind).toBe('candidate_turn');
    expect(snapshot.vacanciesPending).toBe(false);
  });

  it('reports vacanciesPending on a cold pool cache instead of computing it', () => {
    const snapshot = buildTodaySnapshot({
      applications: [],
      newVacancies: undefined,
      sinceLastVisit: null,
      closedVacanciesSinceVisit: 0,
    });

    expect(snapshot.vacanciesPending).toBe(true);
    expect(snapshot.digest.newVacancies).toBe(0);
    expect(snapshot.queue).toHaveLength(0);
  });

  it('adds new vacancies to the queue on a hot cache', () => {
    const snapshot = buildTodaySnapshot({
      applications: [],
      newVacancies: [
        { clusterId: 'c-1', title: 'DevOps', company: 'Acme', firstObservedAt: '2026-09-24T08:00:00.000Z' },
      ],
      sinceLastVisit: '2026-09-23T10:00:00.000Z',
      closedVacanciesSinceVisit: 2,
    });

    expect(snapshot.digest.newVacancies).toBe(1);
    expect(snapshot.digest.closedVacancies).toBe(2);
    expect(snapshot.queue.some((item) => item.kind === 'new_vacancy')).toBe(true);
  });

  it('passes sinceLastVisit through unchanged', () => {
    const snapshot = buildTodaySnapshot({
      applications: [],
      newVacancies: [],
      sinceLastVisit: '2026-09-01T00:00:00.000Z',
      closedVacanciesSinceVisit: 0,
    });

    expect(snapshot.sinceLastVisit).toBe('2026-09-01T00:00:00.000Z');
  });
});
