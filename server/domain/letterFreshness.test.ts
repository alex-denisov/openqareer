import { describe, expect, it } from 'vitest';
import { letterFactMark, letterFreshness, type LetterFactSource } from './letterFreshness';

const source = (hash: string, ...lines: string[]): LetterFactSource => ({ profileHash: hash, lines });
const before = source('a', 'CSAT вырос с 23% до 68%, SLA с 50% до 92%');
const after = source('b', 'CSAT вырос с 25% до 85%, SLA с 50% до 92%');
const LETTER = 'Повысил CSAT с 23% до 68%, SLA с 50% до 92%.';

describe('письмо и текущие факты профиля', () => {
  it('исправленный факт делает письмо устаревшим', () => {
    expect(letterFreshness(after, LETTER, [], letterFactMark(before, LETTER, []))).toEqual({
      factsChanged: true,
      profileChanged: true,
    });
  });

  it('снимок без метки фактов проверяется по числам профиля', () => {
    expect(letterFreshness(after, LETTER, [], null).factsChanged).toBe(true);
    expect(letterFreshness(before, LETTER, [], null).factsChanged).toBe(false);
  });

  it('прежние числа есть в профиле порознь и о другом — переход всё равно опровергнут', () => {
    const apart = source('c', ...after.lines, 'Экономия 23%', 'Доля 68%');
    expect(letterFreshness(apart, LETTER, [], null).factsChanged).toBe(true);
  });

  it('число, которое кандидат вписал и одобрил сам, не устаревает', () => {
    const own = 'Готов выйти через 14 дней.';
    const mark = letterFactMark(before, own, []);
    expect(mark.ownNumbers).not.toHaveLength(0);
    expect(letterFreshness(after, own, [], mark).factsChanged).toBe(false);
  });

  it('текст готовили по прежнему профилю — старое число не становится своим', () => {
    const mark = letterFactMark(after, LETTER, [], 'a');
    expect(mark).toEqual({ profileHash: 'a', ownNumbers: [] });
    expect(letterFreshness(after, LETTER, [], mark).factsChanged).toBe(true);
  });

  it('другой факт изменился — письмо не устарело, но пересобирается', () => {
    const wider = source('d', ...before.lines, 'Новый навык');
    expect(letterFreshness(wider, LETTER, [], letterFactMark(before, LETTER, []))).toEqual({
      factsChanged: false,
      profileChanged: true,
    });
  });
});
