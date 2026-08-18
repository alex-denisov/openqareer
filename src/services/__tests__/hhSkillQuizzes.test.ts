import { describe, expect, it } from 'vitest';
import {
  getAvailableSkillQuizzes,
  getSkillQuizById,
  evaluateSkillQuiz,
} from '../hhSkillQuizzes';

describe('hhSkillQuizzes', () => {
  it('returns a list of available skill verification quizzes', () => {
    const quizzes = getAvailableSkillQuizzes();
    expect(quizzes.length).toBeGreaterThanOrEqual(5);
    expect(quizzes.some((q) => q.id === 'typescript')).toBe(true);
    expect(quizzes.some((q) => q.id === 'react')).toBe(true);
    expect(quizzes.some((q) => q.id === 'nodejs')).toBe(true);
    expect(quizzes.some((q) => q.id === 'qa-automation')).toBe(true);
  });

  it('retrieves quiz details and questions by id', () => {
    const quiz = getSkillQuizById('typescript');
    expect(quiz).toBeDefined();
    expect(quiz?.title).toContain('TypeScript');
    expect(quiz?.questions.length).toBeGreaterThanOrEqual(4);
    expect(quiz?.badgeTitle).toContain('TypeScript');
  });

  it('evaluates quiz submission with score, passed status and verified badge', () => {
    const quiz = getSkillQuizById('typescript')!;
    const answers: Record<string, number> = {};
    // provide correct answers for all questions
    quiz.questions.forEach((q) => {
      answers[q.id] = q.correctOptionIndex;
    });

    const result = evaluateSkillQuiz('typescript', answers);
    expect(result.passed).toBe(true);
    expect(result.scorePercent).toBe(100);
    expect(result.verifiedBadgeAwarded).toBe(true);
    expect(result.badge).toBeDefined();
  });

  it('evaluates failed quiz when score is below passing threshold', () => {
    const quiz = getSkillQuizById('typescript')!;
    const answers: Record<string, number> = {};
    // provide incorrect answers
    quiz.questions.forEach((q) => {
      answers[q.id] = (q.correctOptionIndex + 1) % q.options.length;
    });

    const result = evaluateSkillQuiz('typescript', answers);
    expect(result.passed).toBe(false);
    expect(result.scorePercent).toBeLessThan(quiz.passingScorePercent);
    expect(result.verifiedBadgeAwarded).toBe(false);
  });
});
