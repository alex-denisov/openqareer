import { describe, expect, it } from 'vitest';
import { carryAnswers } from './applicationQuestionnaire';

const question = (id: string, text: string) => ({
  id,
  text,
  required: true,
  kind: 'text' as const,
});
const web = [question('teamtailor_1', 'Salary level?')];
const app = [question('ats-1', 'Salary level? * Required')];

describe('перенос ответов под новый номер вопроса', () => {
  it('узнаёт вопрос по тексту без отметки обязательности', () => {
    const saved = [{ questionId: 'teamtailor_1', text: '25000' }];
    expect(carryAnswers(web, app, saved)).toContainEqual({ questionId: 'ats-1', text: '25000' });
  });

  it('пустой ответ под новым номером не мешает', () => {
    const saved = [
      { questionId: 'teamtailor_1', text: '25000' },
      { questionId: 'ats-1', text: '' },
    ];
    const carried = carryAnswers(web, app, saved).filter((item) => item.questionId === 'ats-1');
    expect(carried).toEqual([{ questionId: 'ats-1', text: '25000' }]);
  });

  it('стёртое остаётся стёртым, написанное под новым номером не меняется', () => {
    expect(carryAnswers(web, app, [{ questionId: 'teamtailor_1', text: '' }])).toContainEqual({
      questionId: 'ats-1',
      text: '',
    });
    const both = [
      { questionId: 'teamtailor_1', text: '25000' },
      { questionId: 'ats-1', text: '30000' },
    ];
    expect(carryAnswers(web, app, both)).toEqual(both);
  });
});
