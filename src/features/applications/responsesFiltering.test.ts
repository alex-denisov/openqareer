import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import {
  countResponsesNeedingAction,
  countResponseStages,
  filterResponseCohort,
  lastDaysRange,
  searchResponses,
  sortResponses,
} from './responsesFiltering';

function application(overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id: 'a1',
    candidateId: 'c1',
    clusterId: null,
    stage: 'applied',
    closedReason: null,
    archiveReason: null,
    archivePreviousStage: null,
    processProfile: 'standard',
    vacancy: {
      title: 'Platform Engineer',
      company: 'Northstar Labs',
      companyHidden: false,
      url: 'https://jobs.test/vacancy',
      source: 'linkedin',
    },
    notes: null,
    followUpDueAt: null,
    stageChangedAt: '2026-10-01T10:00:00.000Z',
    version: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    followUp: null,
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    nearestInterview: null,
    deliveryReceipt: null,
    ...overrides,
  };
}

describe('responsesFiltering', () => {
  it('searches role, visible company, and source without matching a hidden company name', () => {
    const visible = application({ id: 'visible' });
    const hidden = application({
      id: 'hidden',
      vacancy: {
        title: 'Operations Lead',
        company: 'Confidential Employer',
        companyHidden: true,
        url: 'https://jobs.test/vacancy',
        source: 'hh.ru',
      },
    });

    expect(searchResponses([visible, hidden], 'northstar').map((item) => item.id)).toEqual([
      'visible',
    ]);
    expect(searchResponses([visible, hidden], 'platform engineer').map((item) => item.id)).toEqual([
      'visible',
    ]);
    expect(searchResponses([visible, hidden], 'hh.ru').map((item) => item.id)).toEqual(['hidden']);
    expect(searchResponses([visible, hidden], 'confidential employer')).toEqual([]);
  });

  it('counts candidate turns from stored application state', () => {
    const due = application({
      id: 'due',
      whoseTurn: 'candidate',
      followUp: {
        dueAt: '2026-10-02T00:00:00.000Z',
        urgency: 'overdue',
        source: 'standard_schedule',
        daysSinceContact: 14,
      },
    });
    const waiting = application({ id: 'waiting', whoseTurn: 'company' });
    const closed = application({ id: 'closed', stage: 'rejected', whoseTurn: null });

    expect(countResponsesNeedingAction([due, waiting, closed])).toBe(1);
  });

  it('keeps channel and date counts independent from the selected stage chip', () => {
    const applications = [
      application({ id: 'within', stage: 'responded' }),
      application({
        id: 'other-channel',
        stage: 'applied',
        vacancy: {
          title: 'Platform Engineer',
          company: 'Northstar Labs',
          companyHidden: false,
          url: 'https://jobs.test/vacancy',
          source: 'hh.ru',
        },
      }),
      application({ id: 'outside-period', stage: 'offer', createdAt: '2026-08-01T10:00:00.000Z' }),
    ];
    const cohort = filterResponseCohort(applications, {
      stage: ['offer'],
      channel: ['linkedin'],
      from: '2026-09-01',
      to: '2026-10-31',
    });

    expect(cohort.map((item) => item.id)).toEqual(['within']);
    expect(countResponseStages(cohort)).toMatchObject({ responded: 1, applied: 0, offer: 0 });
  });

  it('sorts by the next recorded step and leaves undated steps last', () => {
    const later = application({
      id: 'later',
      followUp: {
        dueAt: '2026-10-12T00:00:00.000Z',
        urgency: 'upcoming',
        source: 'company_deadline',
        daysSinceContact: 1,
      },
    });
    const earlier = application({
      id: 'earlier',
      nearestInterview: {
        id: 'i1',
        scheduledAt: '2026-10-08T10:00:00.000Z',
        prepStatus: 'none',
        round: 1,
      },
    });
    const undated = application({ id: 'undated' });

    expect(sortResponses([undated, later, earlier], 'step').map((item) => item.id)).toEqual([
      'earlier',
      'later',
      'undated',
    ]);
  });

  it('builds an inclusive local calendar period for the date filter', () => {
    expect(lastDaysRange(30, new Date('2026-10-13T12:00:00.000Z'))).toEqual({
      from: '2026-09-14',
      to: '2026-10-13',
    });
  });
});
