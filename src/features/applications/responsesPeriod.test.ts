import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import {
  bulkFilterQuery,
  countHiddenByPeriod,
  filterResponseCohort,
  filterResponsesForQuery,
  OPEN_APPLICATION_STAGES,
  revealApplicationFilters,
} from './responsesFiltering';

function card(id: string, overrides: Partial<ApplicationView>): ApplicationView {
  return {
    id,
    stage: 'applied',
    createdAt: '2026-11-04T10:00:00.000Z',
    whoseTurn: 'company',
    materials: { coverLetter: true, resume: true },
    followUp: null,
    nearestInterview: null,
    closedReason: null,
    vacancy: { title: 'CTO', company: 'Гринкод', url: 'https://x', source: 'hh' },
    ...overrides,
  } as ApplicationView;
}

const LAST_30 = { from: '2026-10-11', to: '2026-11-09' };

const SNOWFLAKE = card('snowflake', {
  createdAt: '2026-10-01T10:00:00.000Z',
  whoseTurn: 'candidate',
  vacancy: { title: 'Director', company: 'Snowflake', url: 'https://x', source: 'linkedin' },
});
const INTOUCH = card('intouch', { stage: 'interview', createdAt: '2026-09-20T10:00:00.000Z' });
const OLD_REJECTED = card('old-rejected', {
  stage: 'rejected',
  createdAt: '2026-09-01T10:00:00.000Z',
});
const OLD_ARCHIVED = card('old-archived', {
  stage: 'archived',
  createdAt: '2026-08-01T10:00:00.000Z',
});
const NEW_REJECTED = card('new-rejected', { stage: 'rejected' });
const ALL = [card('fresh', {}), SNOWFLAKE, INTOUCH, OLD_REJECTED, OLD_ARCHIVED, NEW_REJECTED];

const ids = (list: readonly ApplicationView[]) => list.map((item) => item.id).sort();

describe('the period cuts only closed responses (B632)', () => {
  it('keeps open responses of any age in the default list', () => {
    const query = { stage: OPEN_APPLICATION_STAGES, ...LAST_30 };
    expect(ids(filterResponsesForQuery(ALL, query, '', false, 'step'))).toEqual([
      'fresh',
      'intouch',
      'snowflake',
    ]);
  });

  it('filters closed responses by the period', () => {
    const query = { stage: ['rejected', 'archived'] as const, ...LAST_30 };
    expect(
      ids(filterResponsesForQuery(ALL, { ...query, stage: [...query.stage] }, '', false, 'step')),
    ).toEqual(['new-rejected']);
  });

  it('counts the cohort the same way, so «нужно действие» sees Snowflake', () => {
    expect(ids(filterResponseCohort(ALL, LAST_30))).toEqual([
      'fresh',
      'intouch',
      'new-rejected',
      'snowflake',
    ]);
  });

  it('counts the closed responses the period hides', () => {
    const closed = { stage: ['rejected', 'archived'] as ApplicationView['stage'][], ...LAST_30 };
    expect(countHiddenByPeriod(ALL, closed, '', false)).toBe(2);
    expect(
      countHiddenByPeriod(ALL, { stage: OPEN_APPLICATION_STAGES, ...LAST_30 }, '', false),
    ).toBe(0);
    expect(countHiddenByPeriod(ALL, { ...closed, from: undefined, to: undefined }, '', false)).toBe(
      0,
    );
  });
});

describe('bulkFilterQuery', () => {
  it('drops the dates when only open stages are selected', () => {
    expect(bulkFilterQuery({ stage: OPEN_APPLICATION_STAGES, ...LAST_30 })).toEqual({
      stage: OPEN_APPLICATION_STAGES,
      from: undefined,
      to: undefined,
    });
  });

  it('keeps the dates for closed stages and refuses a mix the server cannot express', () => {
    const closed = { stage: ['rejected'] as ApplicationView['stage'][], ...LAST_30 };
    expect(bulkFilterQuery(closed)).toEqual(closed);
    expect(bulkFilterQuery({ stage: [], ...LAST_30 })).toBeNull();
    expect(bulkFilterQuery({ stage: ['applied', 'rejected'], ...LAST_30 })).toBeNull();
    expect(bulkFilterQuery({ stage: [] })).toEqual({ stage: [] });
  });
});

describe('revealApplicationFilters', () => {
  const current = {
    query: { stage: ['offer'] as ApplicationView['stage'][], channel: ['hh'], ...LAST_30 },
    period: '30' as const,
    search: 'гринкод',
    actionOnly: true,
  };

  it('leaves the filters alone when the response is already visible', () => {
    const visible = card('offer', { stage: 'offer', createdAt: '2026-11-01T10:00:00.000Z' });
    expect(
      revealApplicationFilters(visible, { ...current, search: '', actionOnly: false }),
    ).toBeNull();
  });

  it('opens an old open response in the open funnel without search or channel', () => {
    expect(revealApplicationFilters(SNOWFLAKE, current)).toEqual({
      query: { ...current.query, stage: OPEN_APPLICATION_STAGES, channel: [] },
      period: '30',
      search: '',
      actionOnly: false,
      view: 'columns',
    });
  });

  it('opens an old closed response in the table for all time', () => {
    expect(revealApplicationFilters(OLD_ARCHIVED, current)).toEqual({
      query: { ...current.query, stage: ['archived'], channel: [], from: undefined, to: undefined },
      period: 'all',
      search: '',
      actionOnly: false,
      view: 'table',
    });
  });
});
