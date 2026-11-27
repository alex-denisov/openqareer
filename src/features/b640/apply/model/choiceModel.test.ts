import { describe, expect, it } from 'vitest';
import type { QuestionnaireQuestion } from '../../../../../shared/applicationQuestionnaire';
import { choiceValues, toggleChoice } from './choiceModel';

const SINGLE: QuestionnaireQuestion = {
  id: 'q1',
  text: 'Готовы к командировкам?',
  required: true,
  kind: 'choice',
  options: ['Да', 'Нет'],
};
const MULTI: QuestionnaireQuestion = { ...SINGLE, id: 'q2', text: 'Стек?', options: ['Go', 'Rust', 'Java'], multiple: true };

describe('B703: ответ на вопрос с выбором', () => {
  it('ответ хранится строками: по варианту на строку, пустые отброшены', () => {
    expect(choiceValues('Go\n\nRust ')).toEqual(['Go', 'Rust']);
    expect(choiceValues('')).toEqual([]);
  });

  it('один ответ: выбор заменяет прежний', () => {
    expect(toggleChoice(SINGLE, 'Да', 'Нет')).toBe('Нет');
    expect(toggleChoice(SINGLE, '', 'Да')).toBe('Да');
  });

  it('несколько ответов: отметка добавляет и снимает, порядок — как у вариантов', () => {
    expect(toggleChoice(MULTI, '', 'Java')).toBe('Java');
    expect(toggleChoice(MULTI, 'Java', 'Go')).toBe('Go\nJava');
    expect(toggleChoice(MULTI, 'Go\nJava', 'Go')).toBe('Java');
    expect(toggleChoice(MULTI, 'Java', 'Java')).toBe('');
  });

  it('сохранённый ответ, которого нет среди вариантов, не теряется', () => {
    expect(toggleChoice(MULTI, 'Kotlin', 'Go')).toBe('Go\nKotlin');
  });
});
