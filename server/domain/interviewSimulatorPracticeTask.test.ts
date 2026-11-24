import { describe, expect, it } from 'vitest';
import { buildInterviewQuestionPlan } from './interviewSimulator';

describe('B647: вопрос тренировки System Design', () => {
  it('совпадает с задачей на экране', () => {
    const [question] = buildInterviewQuestionPlan({
      roleTitle: 'Руководитель платформы',
      questionTypes: ['system_design'],
      stressMode: false,
      stories: [],
      systemDesignPrompt: 'Перенос системы. Спроектируйте перенос без остановки.',
      questionIds: ['q1'],
    });
    expect(question?.prompt).toBe('Перенос системы. Спроектируйте перенос без остановки.');
  });
});
