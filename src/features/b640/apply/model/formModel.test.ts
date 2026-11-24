import { describe, expect, it } from 'vitest';
import type { QuestionnaireQuestion } from '../../../../../shared/applicationQuestionnaire';
import { answerOf, answersOf, copyText, readiness, readinessTitle, hhAnswers } from './formModel';

const QUESTIONS: readonly QuestionnaireQuestion[] = [
  { id: 'q1', text: 'Сколько человек было в вашей команде?', required: true, kind: 'text' },
  { id: 'q2', text: 'Ожидаемый уровень дохода?', required: true, kind: 'text' },
  { id: 'q3', text: 'Готовы ли к командировкам?', required: false, kind: 'text' },
];

describe('B641: готовность анкеты на экране', () => {
  it('считает ответы и ведёт к первому обязательному пропуску', () => {
    const state = readiness(QUESTIONS, { q1: '9 человек', q3: '  ' });
    expect(state).toMatchObject({ answered: 1, total: 3, missingRequired: 1 });
    expect(state.nextRequired?.id).toBe('q2');
    expect(readinessTitle(state)).toBe('1 ответ из 3 готов');
    expect(readinessTitle(readiness(QUESTIONS, { q1: 'a', q2: 'b', q3: 'c' }))).toBe('3 ответа из 3 готовы');
  });

  it('идентификатор вопроса, совпавший со встроенным свойством, не ломает экран', () => {
    expect(answerOf({}, 'constructor')).toBe('');
    expect(readiness([{ id: 'toString', text: 'Q', required: true, kind: 'text' }], {}).answered).toBe(0);
  });

  it('стёртый ответ сохраняется пустым, но не копируется', () => {
    expect(answersOf({ q1: ' 9 ', q2: '   ' })).toEqual([
      { questionId: 'q1', text: '9' },
      { questionId: 'q2', text: '' },
    ]);
    expect(copyText(QUESTIONS, { q1: '9 человек', q2: '', q3: 'Да' })).toBe(
      'Сколько человек было в вашей команде?\n9 человек\n\nГотовы ли к командировкам?\nДа',
    );
  });
});

describe('B787: ответы для окна hh.ru', () => {
  it('выбор — по вариантам, текст — целиком, пустых нет', () => {
    const questions = [
      { id: 'a', text: 'А?', required: true, kind: 'text' },
      { id: 'b', text: 'Б?', required: true, kind: 'choice', options: ['x', 'y'], multiple: true },
      { id: 'c', text: 'В?', required: false, kind: 'text' },
    ] as const;
    expect(hhAnswers(questions, { a: ' раз\nдва ', b: 'x\ny', c: ' ' })).toEqual([
      { text: 'А?', values: ['раз\nдва'] },
      { text: 'Б?', values: ['x', 'y'] },
    ]);
  });
});
