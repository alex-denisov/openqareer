import { describe, expect, it } from 'vitest';
import { buildTodaySnapshot, countApplicationsWaitingOver7Days, type TodayNewVacancy } from './todayDigest';
import type { ApplicationView } from './applicationDerivedFields';

function application(overrides: Partial<ApplicationView> = {}): ApplicationView {
  return {
    id: 'app-1',
    candidateId: 'cand-1',
    clusterId: 'cluster-1',
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
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
    fit: { role: 'target', level: 'unknown', geo: null },
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
    expect(item?.fit).toEqual({ role: 'target', level: 'unknown', geo: null });
    expect(snapshot.digest.newVacanciesCaption).toEqual({
      campaignRole: 'DevOps Engineer',
      sourcesCount: 1,
      updatedAt: '2026-09-24T08:00:00.000Z',
    });
    expect(snapshot.sinceLastVisit.items).toContain('1 новая вакансия по роли DevOps Engineer');
  });

  it('marks a stale follow-up as an overdue queue item and follow-up list entry', () => {
    const stale = application({
      followUp: {
        dueAt: '2026-09-22T00:00:00.000Z',
        urgency: 'stale',
        source: 'standard_schedule',
        daysSinceContact: 6,
      },
    });
    const snapshot = buildTodaySnapshot({ ...BASE_INPUT, applications: [stale], newVacancies: [] });

    expect(snapshot.queue[0].kind).toBe('follow_up');
    expect(snapshot.queue[0].eyebrow).toBe('6 дней без ответа');
    expect(snapshot.followUps).toEqual([
      {
        applicationId: 'app-1',
        company: 'FinCloud',
        title: 'Продуктовый аналитик',
        status: 'overdue',
      },
    ]);
    expect(snapshot.digest.followUpsDueToday).toBe(0);
    expect(snapshot.digest.followUpsOverdue).toBe(1);
    expect(snapshot.digest.followUpCaptions).toEqual([]);
  });

  it('counts due-on-UTC-day and overdue reminders separately', () => {
    const due = application({
      id: 'due',
      followUp: {
        dueAt: '2026-09-24T00:00:00.000Z',
        urgency: 'due',
        source: 'standard_schedule',
        daysSinceContact: 5,
      },
    });
    const overdue = application({
      id: 'overdue',
      followUp: {
        dueAt: '2026-09-23T00:00:00.000Z',
        urgency: 'overdue',
        source: 'standard_schedule',
        daysSinceContact: 6,
      },
    });

    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [due, overdue],
      newVacancies: [],
    });

    expect(snapshot.digest.followUpsDueToday).toBe(1);
    expect(snapshot.digest.followUpsOverdue).toBe(1);
    expect(snapshot.followUps).toEqual([
      { applicationId: 'due', company: 'FinCloud', title: 'Продуктовый аналитик', status: 'today' },
      {
        applicationId: 'overdue',
        company: 'FinCloud',
        title: 'Продуктовый аналитик',
        status: 'overdue',
      },
    ]);
  });

  it('counts only follow-ups due today, independent of the capped sidebar list', () => {
    const due = Array.from({ length: 6 }, (_, index) =>
      application({
        id: `due-${index}`,
        followUp: {
          dueAt: '2026-09-24T00:00:00.000Z',
          urgency: 'due',
          source: 'standard_schedule',
          daysSinceContact: 5,
        },
      }),
    );
    const overdue = application({
      id: 'overdue',
      followUp: {
        dueAt: '2026-09-22T00:00:00.000Z',
        urgency: 'stale',
        source: 'standard_schedule',
        daysSinceContact: 7,
      },
    });
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [...due, overdue],
      newVacancies: [],
    });

    expect(snapshot.digest.followUpsDueToday).toBe(6);
    expect(snapshot.followUps).toHaveLength(5);
  });

  it('surfaces the nearest interview across applications', () => {
    const withInterview = application({
      id: 'app-2',
      whoseTurn: 'company',
      nearestInterview: {
        id: 'i1',
        scheduledAt: '2026-09-30T10:00:00.000Z',
        prepStatus: 'none',
        round: 2,
      },
    });
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [withInterview],
      newVacancies: [],
    });

    expect(snapshot.digest.interviewsAhead).toBe(1);
    expect(snapshot.digest.nextInterview).toEqual({
      company: 'FinCloud',
      title: 'Продуктовый аналитик',
      round: 2,
      at: '2026-09-30T10:00:00.000Z',
    });
  });

  it('ignores interviews of archived and rejected applications (B293)', () => {
    const interview = {
      id: 'i1',
      scheduledAt: '2026-09-30T10:00:00.000Z',
      prepStatus: 'none' as const,
      round: 1,
    };
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [
        application({ id: 'a', stage: 'archived', nearestInterview: interview }),
        application({ id: 'r', stage: 'rejected', nearestInterview: interview }),
      ],
      newVacancies: [],
    });

    expect(snapshot.digest.interviewsAhead).toBe(0);
    expect(snapshot.digest.nextInterview).toBeNull();
  });

  it('reports since-last-visit counters as plain strings, skipping zero counts', () => {
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [],
      newVacancies: [],
      since: '2026-09-01T00:00:00.000Z',
      companyEventsSinceVisit: 2,
    });

    expect(snapshot.sinceLastVisit.since).toBe('2026-09-01T00:00:00.000Z');
    expect(snapshot.sinceLastVisit.items).toEqual(['2 события от компаний']);
  });

  it('calculates applications waiting for response over 7 days and structures sinceLastVisit for returning candidate (B255)', () => {
    const waiting9Days = application({
      id: 'app-waiting-9',
      stage: 'applied',
      followUp: {
        dueAt: '2026-09-20T00:00:00.000Z',
        urgency: 'overdue',
        source: 'standard_schedule',
        daysSinceContact: 9,
      },
    });
    const waiting5Days = application({
      id: 'app-waiting-5',
      stage: 'applied',
      followUp: {
        dueAt: '2026-09-24T00:00:00.000Z',
        urgency: 'due',
        source: 'standard_schedule',
        daysSinceContact: 5,
      },
    });
    const archivedOld = application({
      id: 'app-archived',
      stage: 'archived',
      followUp: {
        dueAt: '2026-09-10T00:00:00.000Z',
        urgency: 'stale',
        source: 'standard_schedule',
        daysSinceContact: 15,
      },
    });
    const interview = {
      id: 'i-1',
      scheduledAt: '2026-10-02T14:00:00.000Z',
      prepStatus: 'none' as const,
      round: 1,
    };
    const appWithInterview = application({
      id: 'app-interview',
      stage: 'interview',
      nearestInterview: interview,
    });

    const applications = [waiting9Days, waiting5Days, archivedOld, appWithInterview];

    expect(countApplicationsWaitingOver7Days(applications)).toBe(1);

    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      since: '2026-09-20T10:00:00.000Z',
      applications,
      newVacancies: [newVacancy({ clusterId: 'c-1' }), newVacancy({ clusterId: 'c-2' })],
    });

    expect(snapshot.digest.applicationsWaitingOver7Days).toBe(1);
    expect(snapshot.sinceLastVisit.newVacanciesCount).toBe(2);
    expect(snapshot.sinceLastVisit.applicationsWaitingOver7Days).toBe(1);
    expect(snapshot.sinceLastVisit.nearestInterview).toEqual({
      company: 'FinCloud',
      title: 'Продуктовый аналитик',
      round: 1,
      at: '2026-10-02T14:00:00.000Z',
    });
  });
});

describe('today queue from the shortlist (B266)', () => {
  it('fills the queue with unreviewed shortlist vacancies when nothing is new', () => {
    const shortlist = Array.from({ length: 12 }, (_, index) =>
      newVacancy({ clusterId: `cluster-${index}`, title: `Role ${index}` }),
    );
    const applied = application({ clusterId: 'cluster-0' });
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [applied],
      newVacancies: [newVacancy({ clusterId: 'cluster-1', title: 'Role 1' })],
      shortlist,
    });
    const vacancyItems = snapshot.queue.filter(
      (item) =>
        item.kind !== 'candidate_turn' && item.kind !== 'follow_up' && item.kind !== 'interview',
    );
    expect(vacancyItems[0]).toMatchObject({ kind: 'new_vacancy', clusterId: 'cluster-1' });
    const fromShortlist = vacancyItems
      .filter((item) => item.kind === 'shortlist')
      .map((item) => item.clusterId);
    expect(fromShortlist).not.toContain('cluster-0');
    expect(fromShortlist).not.toContain('cluster-1');
    expect(snapshot.queue.length).toBeLessThanOrEqual(5);
  });

  it('surfaces follow_up reminder for interview stage application when deadline is due (B393)', () => {
    const interviewApp = application({
      id: 'app-interview-1',
      stage: 'interview',
      followUp: {
        dueAt: '2026-10-06T00:00:00.000Z',
        urgency: 'due',
        source: 'company_deadline',
        daysSinceContact: 3,
      },
      vacancy: {
        title: 'Tech Lead',
        company: 'Инновации',
        companyHidden: false,
        source: 'hh',
        url: 'https://example.com',
      },
    });
    const snapshot = buildTodaySnapshot({
      ...BASE_INPUT,
      applications: [interviewApp],
      newVacancies: [],
    });

    expect(snapshot.digest.followUpsDueToday).toBe(1);
    const queueItem = snapshot.queue.find((q) => q.applicationId === 'app-interview-1');
    expect(queueItem).toBeDefined();
    expect(queueItem?.kind).toBe('follow_up');
    expect(queueItem?.company).toBe('Инновации');
  });
});

