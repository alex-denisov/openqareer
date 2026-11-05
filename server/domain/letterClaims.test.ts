import { describe, expect, it } from 'vitest';
import { applyLetterFixes, claimSentenceNumbers } from './letterClaims';

describe('claimSentenceNumbers: what the model check reads', () => {
  const pick = (sentences: string[]) => claimSentenceNumbers(sentences, ['Ритейл Системс']);

  it('takes first-person sentences about the past and the present', () => {
    expect(pick(['I grew the team.', 'Сейчас руковожу инженерией.', 'Я внедрял KPI.', 'Перевёл платформу.'])).toEqual([1, 2, 3, 4]);
  });

  it('takes a result with a number and a sentence naming an employer', () => {
    expect(pick(['Срок сократился с 12 до 7 дней.', 'Ритейл Системс научил многому.'])).toEqual([1, 2]);
  });

  it('leaves opinions about the employer and plans alone', () => {
    expect(pick([
      'Обычно ломается на стыках.',
      'Migration sequencing is where continuity breaks.',
      "I'd like to talk about your platform.",
      'Готов обсудить, как устроено у вас.',
      'Предлагаю созвониться.',
    ])).toEqual([]);
  });
});

describe('applyLetterFixes', () => {
  const body = 'Первое. Второе.\n\nТретье.';

  it('replaces only the named sentence and keeps the paragraphs', () => {
    expect(applyLetterFixes(body, ['Первое.', 'Второе.', 'Третье.'], [{ n: 2, text: 'Другое.' }])).toBe('Первое. Другое.\n\nТретье.');
  });

  it('removes a sentence with an empty fix and a paragraph left empty', () => {
    expect(applyLetterFixes(body, ['Первое.', 'Второе.', 'Третье.'], [{ n: 3, text: '' }])).toBe('Первое. Второе.');
    expect(applyLetterFixes(body, ['Первое.', 'Второе.', 'Третье.'], [{ n: 1, text: '' }])).toBe('Второе.\n\nТретье.');
  });

  it('ignores a number the letter does not have', () => {
    expect(applyLetterFixes(body, ['Первое.', 'Второе.', 'Третье.'], [{ n: 9, text: 'X.' }])).toBe(body);
  });
});
