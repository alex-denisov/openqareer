import { describe, expect, it } from 'vitest';
import { CASE_EVALUATION_INSTRUCTIONS } from './roleSkillAssessmentCaseRoutes';

describe('оценка кейса говорит с кандидатом (B734)', () => {
  it('пояснение по-русски и на «вы», без «Кандидат»', () => {
    const rules = CASE_EVALUATION_INSTRUCTIONS.join('\n');
    expect(rules).toContain('«вы»');
    expect(rules).toContain('«Кандидат»');
    expect(rules).toMatch(/Russian/u);
  });

  it('прежние правила на месте', () => {
    expect(CASE_EVALUATION_INSTRUCTIONS).toContain('Do not infer missing facts or claim experience the answer does not state.');
  });
});
