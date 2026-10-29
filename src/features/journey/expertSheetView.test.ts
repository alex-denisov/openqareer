import { describe, expect, it } from 'vitest';
import { historyQuestion, latestExchange, visibleContextLine } from './expertSheetView';

describe('historyQuestion (A2)', () => {
  it('is one line: the first candidate question, cut with an ellipsis', () => {
    expect(historyQuestion({ firstPhrase: 'Почему именно это\n\nрешение на сегодня?' })).toBe(
      'Почему именно это решение на сегодня?',
    );
    const long = historyQuestion({ firstPhrase: 'в'.repeat(300) });
    expect(long.length).toBeLessThanOrEqual(90);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('latestExchange (A3)', () => {
  const m = (id: string, role: 'user' | 'assistant') => ({ id, role, content: id });
  it('keeps the last question and the answers after it', () => {
    const all = [m('q1', 'user'), m('a1', 'assistant'), m('q2', 'user'), m('a2', 'assistant')];
    expect(latestExchange(all).map((x) => x.id)).toEqual(['q2', 'a2']);
  });
  it('keeps everything when there is no question yet', () => {
    expect(latestExchange([m('a0', 'assistant')]).map((x) => x.id)).toEqual(['a0']);
  });
});

describe('visibleContextLine (A3)', () => {
  it('names only what is sent with the turn', () => {
    expect(visibleContextLine({ hasMarketQuery: false })).toBe('Видит: профиль, условия поиска');
    expect(visibleContextLine({ hasMarketQuery: true })).toBe(
      'Видит: профиль, условия поиска, рынок',
    );
    expect(visibleContextLine({ subjectKind: 'vacancy', hasMarketQuery: false })).toBe(
      'Видит: профиль, эту вакансию',
    );
    expect(visibleContextLine({ subjectKind: 'company', hasMarketQuery: false })).toBe(
      'Видит: профиль, эту компанию',
    );
  });
});
