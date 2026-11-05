import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import {
  draftCoveredByLoaded,
  draftListQuery,
  draftResultCount,
  type ResponsesFilterDraft,
} from './responsesFilterDraft';

const TODAY = new Date(2026, 10, 5);

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

const draft = (overrides: Partial<ResponsesFilterDraft> = {}): ResponsesFilterDraft => ({
  stage: 'все',
  channel: '',
  period: '30',
  sortMode: 'step',
  ...overrides,
});

const LOADED = [
  card('hh-new', {}),
  card('li-new', {
    vacancy: { title: 'VP', company: 'Бета', url: 'https://x', source: 'linkedin' },
  }),
  card('hh-offer', { stage: 'offer' }),
  card('hh-old', { createdAt: '2026-10-20T10:00:00.000Z' }),
  card('hh-closed', { stage: 'rejected' }),
];

describe('draftResultCount', () => {
  it('counts the same list the button will show', () => {
    expect(draftResultCount(LOADED, draft(), '', TODAY)).toBe(5);
  });

  it('narrows by stage, channel and period', () => {
    expect(draftResultCount(LOADED, draft({ stage: 'оффер' }), '', TODAY)).toBe(1);
    expect(draftResultCount(LOADED, draft({ stage: 'закрыто' }), '', TODAY)).toBe(1);
    expect(draftResultCount(LOADED, draft({ channel: 'linkedin' }), '', TODAY)).toBe(1);
    expect(draftResultCount(LOADED, draft({ period: '7' }), '', TODAY)).toBe(4);
  });

  it('respects the search already in the bar', () => {
    expect(draftResultCount(LOADED, draft(), 'бета', TODAY)).toBe(1);
  });
});

describe('draftCoveredByLoaded', () => {
  it('can count locally when the loaded period holds the draft period', () => {
    expect(draftCoveredByLoaded('30', '7')).toBe(true);
    expect(draftCoveredByLoaded('30', '30')).toBe(true);
    expect(draftCoveredByLoaded('all', '90')).toBe(true);
  });

  it('cannot when the draft reaches further back than what is loaded', () => {
    expect(draftCoveredByLoaded('30', '90')).toBe(false);
    expect(draftCoveredByLoaded('30', 'all')).toBe(false);
  });
});

describe('draftListQuery', () => {
  it('asks the server for one row of the draft to read its total', () => {
    expect(draftListQuery(draft({ stage: 'интервью', channel: 'hh', period: '7' }), TODAY)).toEqual(
      {
        stage: ['interview'],
        channel: ['hh'],
        from: '2026-10-30',
        to: '2026-11-05',
        limit: 1,
        offset: 0,
      },
    );
  });

  it('has no server query for «нужно действие»: the server cannot filter it', () => {
    expect(draftListQuery(draft({ stage: 'нужно действие', period: 'all' }), TODAY)).toBeNull();
  });
});
