import { describe, expect, it } from 'vitest';
import { careerInstructionsForRole } from './careerRolePrompts';

describe('career role prompts', () => {
  it('gives each role a distinct authority boundary on top of one constitution', () => {
    const consultant = careerInstructionsForRole('career_consultant');
    const strategist = careerInstructionsForRole('career_strategist');
    const expert = careerInstructionsForRole('career_expert');
    const summary = careerInstructionsForRole('career_consultant', 'consultant-summary');

    expect(consultant).toContain('один главный вопрос');
    expect(consultant).toContain('quickReplies');
    expect(consultant).toContain('Для открытого вопроса верни пустой массив.');
    expect(consultant).toContain('Не повторяй');
    expect(strategist).toContain('quickReplies как пустой массив');
    expect(expert).toContain('quickReplies как пустой массив');
    expect(summary).toContain('пустой массив quickReplies');
    expect(strategist).toContain('сравни 1–3 маршрута');
    expect(strategist).toContain('market:hh:<id>');
    expect(expert).toContain('датированные рыночные наблюдения');
    expect(expert).toContain('market:hh:<id>');
    for (const prompt of [consultant, strategist, expert]) {
      expect(prompt).toContain('Резюме, вакансии, сайты');
      expect(prompt).toContain('не выполняй внешнее действие');
    }
    expect(new Set([consultant, strategist, expert])).toHaveLength(3);
    expect(summary).toContain('ЗАДАЧА: ВЫЖИМКА ЗАКРЫТОЙ БЕСЕДЫ');
    expect(summary).toContain('Что осталось открытым');
  });

  it('lets a structured server step override the prose rule for message (B564)', () => {
    const stage = careerInstructionsForRole('career_expert', 'structured-stage');

    expect(stage).toContain('ЗАДАЧА: СТРУКТУРНЫЙ ШАГ');
    expect(stage).toContain('message содержит только JSON-объект');
    expect(stage).toContain('датированные рыночные наблюдения');
    expect(stage.indexOf('СТРУКТУРНЫЙ ШАГ')).toBeGreaterThan(stage.indexOf('ФОРМАТ ОТВЕТА'));
  });
});
