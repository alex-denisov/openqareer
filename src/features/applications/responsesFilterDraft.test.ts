import { describe, expect, it } from 'vitest';
import type { ApplicationView } from './applicationsApi';
import { draftResultCount, type ResponsesFilterDraft } from './responsesFilterDraft';

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
  card('hh-closed-old', { stage: 'rejected', createdAt: '2026-10-20T10:00:00.000Z' }),
];

describe('draftResultCount', () => {
  it('counts the same list the button will show', () => {
    expect(draftResultCount(LOADED, draft(), '', TODAY)).toBe(6);
  });

  it('narrows by stage, channel and period', () => {
    expect(draftResultCount(LOADED, draft({ stage: 'оффер' }), '', TODAY)).toBe(1);
    expect(draftResultCount(LOADED, draft({ stage: 'закрыто' }), '', TODAY)).toBe(2);
    expect(draftResultCount(LOADED, draft({ channel: 'linkedin' }), '', TODAY)).toBe(1);
    // The period trims closed rows only: the old open «hh-old» stays (B632).
    expect(draftResultCount(LOADED, draft({ period: '7' }), '', TODAY)).toBe(5);
    expect(draftResultCount(LOADED, draft({ stage: 'закрыто', period: '7' }), '', TODAY)).toBe(1);
  });

  it('respects the search already in the bar', () => {
    expect(draftResultCount(LOADED, draft(), 'бета', TODAY)).toBe(1);
  });
});
