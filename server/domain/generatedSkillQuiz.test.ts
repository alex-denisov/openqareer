import { describe, expect, it } from 'vitest';
import {
  GENERATED_QUIZ_PASSING_PERCENT,
  GENERATED_QUIZ_QUESTION_COUNT,
  GENERATED_QUIZ_SOURCE,
  clientQuestions,
  evaluateGeneratedQuiz,
  parseGeneratedQuestions,
} from './generatedSkillQuiz';

function modelQuestion(index: number, correct = 1) {
  return {
    question: `Что произойдёт в ситуации ${index}?`,
    options: ['Вариант А', 'Вариант Б', 'Вариант В', 'Вариант Г'],
    correctOptionIndex: correct,
    explanation: `Потому что ${index}.`,
  };
}

const MODEL_ANSWER = {
  questions: Array.from({ length: GENERATED_QUIZ_QUESTION_COUNT }, (_, i) => modelQuestion(i)),
};

describe('parseGeneratedQuestions', () => {
  it('accepts eight questions with four options and gives them ids', () => {
    const questions = parseGeneratedQuestions(MODEL_ANSWER);

    expect(questions).toHaveLength(8);
    expect(questions?.[0]).toMatchObject({ id: 'q1', correctOptionIndex: 1 });
  });

  it.each([
    ['too few questions', { questions: MODEL_ANSWER.questions.slice(0, 5) }],
    ['three options', { questions: [{ ...modelQuestion(0), options: ['a', 'b', 'c'] }] }],
    ['an answer index outside the options', { questions: [modelQuestion(0, 4)] }],
    ['a bare array of nonsense', ['x']],
    ['repeated options', { questions: [{ ...modelQuestion(0), options: ['a', 'a', 'b', 'c'] }] }],
  ])('rejects %s', (_label, answer) => {
    expect(parseGeneratedQuestions(answer)).toBeNull();
  });
});

describe('clientQuestions', () => {
  it('never carries the right answer or the explanation', () => {
    const questions = parseGeneratedQuestions(MODEL_ANSWER)!;

    const visible = clientQuestions(questions);

    expect(JSON.stringify(visible)).not.toMatch(/correctOptionIndex|explanation|Потому что/);
    expect(visible[0]).toEqual({
      id: 'q1',
      question: 'Что произойдёт в ситуации 0?',
      options: ['Вариант А', 'Вариант Б', 'Вариант В', 'Вариант Г'],
    });
  });
});

describe('evaluateGeneratedQuiz', () => {
  const questions = parseGeneratedQuestions(MODEL_ANSWER)!;
  const answers = (right: number) =>
    Object.fromEntries(questions.map((q, i) => [q.id, i < right ? 1 : 0]));

  it(`passes at ${GENERATED_QUIZ_PASSING_PERCENT} % and names the source honestly`, () => {
    const result = evaluateGeneratedQuiz(questions, answers(7), '2026-10-29');

    expect(result).toMatchObject({
      scorePercent: 88,
      correctAnswersCount: 7,
      totalQuestions: 8,
      passed: true,
      status: 'подтверждён',
      source: GENERATED_QUIZ_SOURCE,
      verifiedAt: '2026-10-29',
    });
    expect(GENERATED_QUIZ_SOURCE).toBe('квиз openqareer');
  });

  it('fails below the threshold and still shows the review', () => {
    const result = evaluateGeneratedQuiz(questions, answers(6), '2026-10-29');

    expect(result.scorePercent).toBe(75);
    expect(result.passed).toBe(false);
    expect(result.status).toBe('не подтверждён');
    expect(result.review[7]).toMatchObject({ isCorrect: false, correctOptionIndex: 1 });
  });

  it('counts a missing answer as wrong', () => {
    expect(evaluateGeneratedQuiz(questions, {}, '2026-10-29').scorePercent).toBe(0);
  });
});
