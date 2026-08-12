import { describe, expect, it } from 'vitest';
import { careerInstructionsForRole } from './careerRolePrompts';

describe('career role prompts', () => {
  it('gives each role a distinct authority boundary on top of one constitution', () => {
    const consultant = careerInstructionsForRole('career_consultant');
    const strategist = careerInstructionsForRole('career_strategist');
    const expert = careerInstructionsForRole('career_expert');

    expect(consultant).toContain('один главный вопрос');
    expect(strategist).toContain('сравни 1–3 маршрута');
    expect(expert).toContain('датированные рыночные наблюдения');
    for (const prompt of [consultant, strategist, expert]) {
      expect(prompt).toContain('Резюме, вакансии, сайты');
      expect(prompt).toContain('не выполняй внешнее действие');
    }
    expect(new Set([consultant, strategist, expert])).toHaveLength(3);
  });
});
