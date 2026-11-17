import { describe, expect, it } from 'vitest';
import { hiddenNote, mergeHidden } from './hiddenModel';
import { makeItem } from './fixtures';

const at = '2026-11-11T09:00:00Z';

describe('текст ⓘ скрытой строки', () => {
  it('дата и подпись причины', () => {
    expect(hiddenNote({ reasonId: 'comp-below', at })).toBe('Скрыто 11.11 · Зарплата ниже ожиданий');
  });

  it('неизвестная причина — только дата', () => {
    expect(hiddenNote({ reasonId: 'unknown-id', at })).toBe('Скрыто 11.11');
  });

  it('нечитаемая дата — без даты', () => {
    expect(hiddenNote({ reasonId: 'stale', at: 'x' })).toBe('Скрыто · Неактуально или дубль');
  });
});

describe('слияние скрытых за сессию и с сервера', () => {
  const entry = (id: string) => ({ ...makeItem({ id }), hidden: { reasonId: 'stale', at } });

  it('свежие первыми, повторы с сервера убираются', () => {
    const merged = mergeHidden([entry('s1'), entry('a')], [entry('a'), entry('b')]);
    expect(merged.map((row) => row.cluster.id)).toEqual(['s1', 'a', 'b']);
  });
});
