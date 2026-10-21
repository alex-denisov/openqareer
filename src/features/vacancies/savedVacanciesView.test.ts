import { describe, expect, it } from 'vitest';
import {
  formatShortDate,
  savedClosedLabel,
  savedVacanciesView,
  type SavedVacancyEntry,
} from './savedVacanciesView';

function entry(
  id: string,
  savedAt: string,
  company: string,
  state?: SavedVacancyEntry['state'],
): SavedVacancyEntry {
  return { id, title: `Role ${id}`, company, savedAt, state };
}

const items: readonly SavedVacancyEntry[] = [
  entry('a', '2026-10-02T10:00:00.000Z', 'Облако+', {
    closed: true,
    closedAt: '2026-10-06T09:00:00.000Z',
  }),
  entry('b', '2026-10-06T10:00:00.000Z', 'Вектор Банк', {
    closed: false,
    salary: { from: 450_000, to: 600_000 },
  }),
  entry('c', '2026-10-05T10:00:00.000Z', 'Гринкод', {
    closed: false,
    salary: { from: 600_000, to: 750_000 },
  }),
  entry('d', '2026-10-04T10:00:00.000Z', 'Арка Холдинг', { closed: false }),
  entry('e', '2026-10-03T10:00:00.000Z', 'Альфа'),
];

const ids = (list: readonly SavedVacancyEntry[]) => list.map((item) => item.id);

describe('savedVacanciesView', () => {
  it('sorts by save date, newest first', () => {
    expect(ids(savedVacanciesView(items, { query: '', state: 'all', sort: 'saved' }))).toEqual([
      'b',
      'c',
      'd',
      'e',
      'a',
    ]);
  });

  it('sorts by money, vacancies without salary last', () => {
    expect(ids(savedVacanciesView(items, { query: '', state: 'all', sort: 'money' }))).toEqual([
      'c',
      'b',
      'd',
      'e',
      'a',
    ]);
  });

  it('sorts by company name', () => {
    expect(ids(savedVacanciesView(items, { query: '', state: 'all', sort: 'company' }))).toEqual([
      'e',
      'd',
      'b',
      'c',
      'a',
    ]);
  });

  it('filters closed and open; unknown state counts as open', () => {
    expect(ids(savedVacanciesView(items, { query: '', state: 'closed', sort: 'saved' }))).toEqual([
      'a',
    ]);
    expect(ids(savedVacanciesView(items, { query: '', state: 'open', sort: 'saved' }))).toEqual([
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('searches company or role', () => {
    expect(ids(savedVacanciesView(items, { query: 'гринк', state: 'all', sort: 'saved' }))).toEqual(
      ['c'],
    );
    expect(
      ids(savedVacanciesView(items, { query: 'role d', state: 'all', sort: 'saved' })),
    ).toEqual(['d']);
  });
});

describe('date labels', () => {
  it('formats DD.MM', () => {
    expect(formatShortDate('2026-10-06T09:00:00.000Z')).toBe('06.10');
    expect(formatShortDate('broken')).toBeUndefined();
  });

  it('labels closure only when it is known', () => {
    expect(savedClosedLabel({ closed: true, closedAt: '2026-10-06T09:00:00.000Z' })).toBe(
      'закрыта на площадке 06.10',
    );
    expect(savedClosedLabel({ closed: true })).toBe('закрыта на площадке');
    expect(savedClosedLabel({ closed: false })).toBeUndefined();
    expect(savedClosedLabel(undefined)).toBeUndefined();
  });
});
