import { describe, expect, it } from 'vitest';
import { evaluateCareerGoalRisk } from './careerDiary';

const baseGoal = {
  id: 'goal-incidents',
  title: 'Снизить число инцидентов P1',
  type: 'operational' as const,
  horizon: 'quarter' as const,
  startDate: '2026-12-01',
  dueDate: '2026-12-31',
  unit: 'инцидентов в месяц',
  baselineValue: 9,
  targetValue: 4,
};

describe('career diary goal risk', () => {
  it('compares a decreasing metric with its linear plan and explains the rule', () => {
    const risk = evaluateCareerGoalRisk(
      baseGoal,
      { value: 8, measuredAt: '2026-12-15' },
      '2026-12-15',
    );

    expect(risk).toMatchObject({
      status: 'at_risk',
      rule: 'linear_progress_v1',
      expectedValue: 6.67,
      actualValue: 8,
    });
    expect(risk.explanation).toContain('линейному плану');
  });

  it('keeps an increasing metric on plan when it meets the interpolated value', () => {
    const risk = evaluateCareerGoalRisk(
      {
        ...baseGoal,
        baselineValue: 3,
        targetValue: 8,
        unit: 'закрытых вакансий',
      },
      { value: 6, measuredAt: '2026-12-19' },
      '2026-12-19',
    );

    expect(risk.status).toBe('on_track');
    expect(risk.expectedValue).toBe(6);
  });

  it('marks a goal achieved only after a measurement reaches its target', () => {
    const risk = evaluateCareerGoalRisk(
      baseGoal,
      { value: 4, measuredAt: '2026-12-15' },
      '2026-12-15',
    );

    expect(risk).toMatchObject({ status: 'achieved', rule: 'target_reached' });
  });

  it('does not estimate risk without a usable numeric measurement', () => {
    const risk = evaluateCareerGoalRisk(baseGoal, null, '2026-12-15');

    expect(risk).toMatchObject({ status: 'unknown', rule: 'measurement_required' });
    expect(risk.expectedValue).toBeUndefined();
  });

  it('does not invent a numeric risk formula for boolean goals', () => {
    const risk = evaluateCareerGoalRisk(
      { ...baseGoal, baselineValue: null, targetValue: true, unit: 'да/нет' },
      { value: false, measuredAt: '2026-12-15' },
      '2026-12-15',
    );

    expect(risk).toMatchObject({ status: 'unknown', rule: 'non_numeric_goal' });
    expect(risk.explanation).toContain('числового сравнения нет');
  });
});
