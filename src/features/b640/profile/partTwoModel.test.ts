import { describe, expect, it } from 'vitest';
import type { ResumeDraft } from '../../resume/resumeTypes';
import { nextQuestion, teamAnswer } from './partTwoModel';

const draft = (experience: unknown[]) =>
  ({ candidate: {}, experience, education: [], languages: [] }) as unknown as ResumeDraft;

describe('b640 profile: один вопрос о профиле', () => {
  it('спрашивает размер команды у первого места, где он не указан', () => {
    const question = nextQuestion(
      draft([
        { id: 'e1', employer: 'Финтех Лаб', teamSize: 9 },
        { id: 'e2', employer: 'Сфера Платежи' },
        { id: 'e3', employer: 'Ритейл Тех' },
      ]),
    );
    expect(question).toEqual({
      entryId: 'e2',
      employer: 'Сфера Платежи',
      text: 'Сколько человек было в команде в «Сфера Платежи»?',
    });
  });

  it('без названия компании спрашивает по должности; вопросов нет — null', () => {
    expect(nextQuestion(draft([{ id: 'e1', title: 'Аналитик' }]))?.text).toBe(
      'Сколько человек было в команде на месте «Аналитик»?',
    );
    expect(nextQuestion(draft([{ id: 'e1', employer: 'x', teamSize: 3 }]))).toBeNull();
    expect(nextQuestion(draft([]))).toBeNull();
  });

  it('ответ — целое число от 1 до 100 000', () => {
    expect(teamAnswer(' 9 ')).toBe(9);
    expect(teamAnswer('0')).toBeNull();
    expect(teamAnswer('девять')).toBeNull();
    expect(teamAnswer('1000000')).toBeNull();
    expect(teamAnswer('')).toBeNull();
  });
});
