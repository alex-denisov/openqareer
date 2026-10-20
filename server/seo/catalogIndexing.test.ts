import { describe, expect, it } from 'vitest';
import {
  isIndexableListing,
  CARD_POSTED_WITHIN_DAYS,
  CARD_SEEN_WITHIN_DAYS,
  DEEP_PAGE_NOINDEX_AFTER,
  isIndexableCard,
  isIndexablePage,
  validThroughOf,
} from './catalogIndexing';

const NOW = new Date('2026-10-20T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

const valuable = {
  title: 'Frontend Developer',
  company: 'Acme',
  salaryLabel: '5 000 — 6 000 USD',
  publishedAt: daysAgo(2),
  lastSeenAt: daysAgo(0),
};

describe('isIndexableCard', () => {
  it('indexes a fresh card with salary, employer and an English role', () => {
    expect(isIndexableCard(valuable, NOW)).toBe(true);
  });

  it('drops a card without salary, without employer or without an English role', () => {
    expect(isIndexableCard({ ...valuable, salaryLabel: undefined }, NOW)).toBe(false);
    expect(isIndexableCard({ ...valuable, company: '  ' }, NOW)).toBe(false);
    expect(isIndexableCard({ ...valuable, title: 'Щебень' }, NOW)).toBe(false);
  });

  it('drops a card nobody has seen for more than the seen window', () => {
    expect(
      isIndexableCard({ ...valuable, lastSeenAt: daysAgo(CARD_SEEN_WITHIN_DAYS - 1) }, NOW),
    ).toBe(true);
    expect(
      isIndexableCard({ ...valuable, lastSeenAt: daysAgo(CARD_SEEN_WITHIN_DAYS + 1) }, NOW),
    ).toBe(false);
  });

  it('drops a card posted before the posting window, however often it is seen', () => {
    expect(
      isIndexableCard({ ...valuable, publishedAt: daysAgo(CARD_POSTED_WITHIN_DAYS + 1) }, NOW),
    ).toBe(false);
  });

  it('treats an unparseable date as not fresh', () => {
    expect(isIndexableCard({ ...valuable, lastSeenAt: 'never' }, NOW)).toBe(false);
  });
});

describe('validThroughOf', () => {
  it('is the withdrawal date when the source named one', () => {
    expect(validThroughOf('2026-10-01T00:00:00.000Z', '2026-10-15T08:00:00.000Z')).toBe(
      '2026-10-15T08:00:00.000Z',
    );
  });

  it('is thirty days after posting otherwise', () => {
    expect(validThroughOf('2026-10-01T09:30:00.000Z')).toBe('2026-10-31T09:30:00.000Z');
  });

  it('is absent when the posting date is unparseable', () => {
    expect(validThroughOf('soon')).toBeUndefined();
  });
});

describe('isIndexablePage', () => {
  it('indexes the first pages and leaves deep pagination to links only', () => {
    expect(isIndexablePage(1)).toBe(true);
    expect(isIndexablePage(DEEP_PAGE_NOINDEX_AFTER)).toBe(true);
    expect(isIndexablePage(DEEP_PAGE_NOINDEX_AFTER + 1)).toBe(false);
  });
});

describe('isIndexableListing', () => {
  it('indexes a place from 10 vacancies and a place+role from 5', () => {
    expect(isIndexableListing(9, false)).toBe(false);
    expect(isIndexableListing(10, false)).toBe(true);
    expect(isIndexableListing(4, true)).toBe(false);
    expect(isIndexableListing(5, true)).toBe(true);
  });
});
