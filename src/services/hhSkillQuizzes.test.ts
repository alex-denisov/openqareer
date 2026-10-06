import { describe, expect, it } from 'vitest';
import {
  getAvailableSkillQuizzes,
  getSkillQuizById,
  evaluateSkillQuiz,
  buildSkillVerificationFact,
  createSkillVerificationProposal,
} from './hhSkillQuizzes';

describe('hhSkillQuizzes bank & evaluation (B376 / US-01.3)', () => {
  it('содержит банк тестов hh.ru и LinkedIn с 3–5 вопросами в каждом', () => {
    const quizzes = getAvailableSkillQuizzes();
    expect(quizzes.length).toBeGreaterThanOrEqual(5);

    const platforms = new Set(quizzes.map((q) => q.platform));
    expect(platforms.has('hh.ru')).toBe(true);
    expect(platforms.has('linkedin')).toBe(true);

    for (const quiz of quizzes) {
      expect(quiz.questions.length).toBeGreaterThanOrEqual(3);
      expect(quiz.questions.length).toBeLessThanOrEqual(5);
      expect(quiz.title).toBeTruthy();
      expect(quiz.passingScorePercent).toBeGreaterThan(0);
    }
  });

  it('позволяет найти тест по id', () => {
    const tsQuiz = getSkillQuizById('typescript');
    expect(tsQuiz).toBeDefined();
    expect(tsQuiz?.title).toContain('TypeScript');
  });

  it('при успешной сдаче квиза возвращает статус «подтверждён» с источником и датой', () => {
    const quiz = getSkillQuizById('typescript');
    expect(quiz).toBeDefined();
    if (!quiz) return;

    // Все правильные ответы
    const allCorrectAnswers: Record<string, number> = {};
    for (const q of quiz.questions) {
      allCorrectAnswers[q.id] = q.correctOptionIndex;
    }

    const result = evaluateSkillQuiz(quiz.id, allCorrectAnswers);
    expect(result.passed).toBe(true);
    expect(result.scorePercent).toBe(100);
    expect(result.status).toBe('подтверждён');
    expect(result.source).toContain('hh.ru');
    expect(result.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);

    const fact = buildSkillVerificationFact('TypeScript', result);
    expect(fact.status).toBe('подтверждён');
    expect(fact.source).toBe(result.source);
    expect(fact.date).toBe(result.verifiedAt);
    expect(fact.statement).toContain('TypeScript: подтверждён');
  });

  it('при несданном квизе формулирует статус честно: «не подтверждено», без «слабый навык»', () => {
    const quiz = getSkillQuizById('typescript');
    expect(quiz).toBeDefined();
    if (!quiz) return;

    // Все неправильные ответы
    const allWrongAnswers: Record<string, number> = {};
    for (const q of quiz.questions) {
      allWrongAnswers[q.id] = (q.correctOptionIndex + 1) % q.options.length;
    }

    const result = evaluateSkillQuiz(quiz.id, allWrongAnswers);
    expect(result.passed).toBe(false);
    expect(result.scorePercent).toBe(0);
    expect(result.status).toBe('не подтверждён');
    expect(result.statusLabel).toBe('не подтверждено');
    expect(result.statusLabel).not.toContain('слабый навык');

    const fact = buildSkillVerificationFact('TypeScript', result);
    expect(fact.status).toBe('не подтверждён');
    expect(fact.statement).toContain('не подтверждено');
    expect(fact.statement).not.toContain('слабый навык');
  });

  it('создаёт предложение консультанта с откатом для изменения статуса навыка', () => {
    const quiz = getSkillQuizById('typescript')!;
    const answers: Record<string, number> = {};
    for (const q of quiz.questions) {
      answers[q.id] = q.correctOptionIndex;
    }
    const result = evaluateSkillQuiz(quiz.id, answers);
    const proposal = createSkillVerificationProposal('TypeScript', result, 'memory-fact-ts-1');

    expect(proposal.kind).toBe('resume.revise');
    expect(proposal.objective).toContain('TypeScript');
    expect(proposal.objective).toContain('подтверждён');
    expect(proposal.resumeRevision?.section).toBe('skills');
    expect(proposal.resumeRevision?.proposedText).toContain('TypeScript');
    expect(proposal.evidenceRefs).toContain('memory:fact-ts-1');
  });
});
