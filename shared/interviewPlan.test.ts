import { describe, expect, it } from 'vitest';
import { buildInterviewQuestionPlan } from '../server/domain/interviewSimulator';
import { countPlannedQuestionTypes, estimateInterviewMinutes, INTERVIEW_QUESTION_COUNT } from './interviewPlan';

describe('interviewPlan', () => {
  it.each([
    [['behavioral', 'system_design']],
    [['behavioral']],
    [['system_design']],
  ] as const)('counts the same question types the server plan builds for %j', (questionTypes) => {
    const plan = buildInterviewQuestionPlan({
      roleTitle: 'CTO',
      questionTypes,
      stressMode: false,
      stories: [],
      questionIds: Array.from({ length: INTERVIEW_QUESTION_COUNT }, (_, index) => `q${index}`),
    });
    const counts = countPlannedQuestionTypes(questionTypes);
    expect(counts.behavioral).toBe(plan.filter((item) => item.type === 'behavioral').length);
    expect(counts.system_design).toBe(plan.filter((item) => item.type === 'system_design').length);
  });

  it('rounds the training length up to five minutes', () => {
    expect(estimateInterviewMinutes(5)).toBe(15);
    expect(estimateInterviewMinutes(10)).toBe(25);
  });
});
