import { describe, expect, it } from 'vitest';
import type { QuestionnaireQuestion } from '../../../../../shared/applicationQuestionnaire';
import { answersOf, copyText, readiness, readinessTitle } from './formModel';

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

  it('пустые ответы не сохраняются и не копируются', () => {
    expect(answersOf({ q1: ' 9 ', q2: '   ' })).toEqual([{ questionId: 'q1', text: '9' }]);
    expect(copyText(QUESTIONS, { q1: '9 человек', q2: '', q3: 'Да' })).toBe(
      'Сколько человек было в вашей команде?\n9 человек\n\nГотовы ли к командировкам?\nДа',
    );
  });
});
