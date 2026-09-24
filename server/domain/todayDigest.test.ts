import { describe, expect, it } from 'vitest';
import { buildTodaySnapshot, type TodayNewVacancy } from './todayDigest';
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

function newVacancy(overrides: Partial<TodayNewVacancy> = {}): TodayNewVacancy {
  return {
    clusterId: 'c-1',
    title: 'DevOps',
    company: 'Acme',
    firstObservedAt: '2026-09-24T08:00:00.000Z',
    lastSeenAt: '2026-09-24T08:00:00.000Z',
    sourcesCount: 1,
    fit: { role: 'target', level: null, geo: null },
    ...overrides,
  };
}

const BASE_INPUT = {
  since: '2026-09-23T10:00:00.000Z',
  closedVacanciesSinceVisit: 0,
  campaignRole: null,
  companyEventsSinceVisit: 0,
};

describe('buildTodaySnapshot (B251, S4/S4b, architecture.md §57)', () => {
  it('collects applications waiting on the candidate into the queue', () => {
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [application(), application({ id: 'app-2', whoseTurn: 'company' })],
      newVacancies: [],
    });

    expect(snapshot.digest.waitingForYou).toBe(1);
    expect(snapshot.queue).toHaveLength(1);
    expect(snapshot.queue[0].kind).toBe('candidate_turn');
    expect(snapshot.queue[0].company).toBe('FinCloud');
    expect(snapshot.vacanciesPending).toBe(false);
  });

  it('reports vacanciesPending on a cold pool cache instead of computing it', () => {
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [],
      newVacancies: undefined,
      since: null,
    });

    expect(snapshot.vacanciesPending).toBe(true);
    expect(snapshot.digest.newVacancies).toBe(0);
    expect(snapshot.queue).toHaveLength(0);
    expect(snapshot.digest.newVacanciesCaption).toBeNull();
  });

  it('adds new vacancies to the queue with fit and caption on a hot cache', () => {
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [],
      newVacancies: [newVacancy()],
      closedVacanciesSinceVisit: 2,
      campaignRole: 'DevOps Engineer',
    });

    expect(snapshot.digest.newVacancies).toBe(1);
    expect(snapshot.digest.closedVacancies).toBe(2);
    const item = snapshot.queue.find((entry) => entry.kind === 'new_vacancy');
    expect(item?.eyebrow).toBe('сегодня');
    expect(item?.fit).toEqual({ role: 'target', level: null, geo: null });
    expect(snapshot.digest.newVacanciesCaption).toEqual({
      campaignRole: 'DevOps Engineer',
      sourcesCount: 1,
      updatedAt: '2026-09-24T08:00:00.000Z',
    });
    expect(snapshot.sinceLastVisit.items).toContain('1 новая вакансия по роли DevOps Engineer');
  });

  it('marks a stale follow-up as an overdue queue item and follow-up list entry', () => {
    const stale = application({
      followUp: { dueAt: '2026-09-22T00:00:00.000Z', urgency: 'stale', source: 'standard_schedule', businessDaysSinceContact: 6 },
    });
    const snapshot = buildTodaySnapshot({ ...BASE_INPUT, applications: [stale], newVacancies: [] });

    expect(snapshot.queue[0].kind).toBe('follow_up');
    expect(snapshot.queue[0].eyebrow).toBe('6 рабочих дней без ответа');
    expect(snapshot.followUps).toEqual([
      { applicationId: 'app-1', company: 'FinCloud', title: 'Продуктовый аналитик', status: 'overdue' },
    ]);
    expect(snapshot.digest.followUpCaptions).toEqual(['FinCloud — 6 рабочих дней тишины']);
  });

  it('surfaces the nearest interview across applications', () => {
    const withInterview = application({
      id: 'app-2',
      whoseTurn: 'company',
      nearestInterview: { id: 'i1', scheduledAt: '2026-09-30T10:00:00.000Z', prepStatus: 'none', round: 2 },
    });
    const snapshot = buildTodaySnapshot({ ...BASE_INPUT, applications: [withInterview], newVacancies: [] });

    expect(snapshot.digest.interviewsAhead).toBe(1);
    expect(snapshot.digest.nextInterview).toEqual({
      company: 'FinCloud',
      title: 'Продуктовый аналитик',
      round: 2,
      at: '2026-09-30T10:00:00.000Z',
    });
  });

  it('reports since-last-visit counters as plain strings, skipping zero counts', () => {
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [],
      newVacancies: [],
      since: '2026-09-01T00:00:00.000Z',
      companyEventsSinceVisit: 2,
    });

    expect(snapshot.sinceLastVisit).toEqual({
      since: '2026-09-01T00:00:00.000Z',
      items: ['2 события от компаний'],
    });
  });
});
