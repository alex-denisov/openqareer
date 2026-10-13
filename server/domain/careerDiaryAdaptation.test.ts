import { describe, expect, it } from 'vitest';
import { careerDiaryPlanningSchema, careerDiaryQuarterDecisionSchema } from './careerDiaryAdaptation';

const task = {
  id: 'task-1',
  title: 'Сверить ожидания',
  description: 'Уточнить приоритеты первых недель.',
  stage: 'prep',
  category: 'alignment',
  dueDate: '2026-11-06',
  completed: false,
  source: 'template',
};

const plan = {
  id: 'plan-1',
  workplaceId: 'workplace-1',
  startDate: '2026-11-06',
  createdAt: '2026-10-20T12:00:00.000Z',
  status: 'active',
  closedAt: null,
  tasks: [task],
};

describe('career diary planning payload', () => {
  it('accepts a workplace plan with candidate-owned tasks', () => {
    expect(careerDiaryPlanningSchema.safeParse({ adaptationPlan: plan }).success).toBe(true);
  });

  it('validates the quarter decision recorded with its goal', () => {
    expect(careerDiaryQuarterDecisionSchema.safeParse({
      quarterId: 'Q4 2026',
      decision: 'keep',
      decidedAt: '2026-12-06',
    }).success).toBe(true);
    expect(careerDiaryQuarterDecisionSchema.safeParse({
      quarterId: 'Q7 2026',
      decision: 'move',
      decidedAt: '2026-12-06',
    }).success).toBe(false);
  });

  it('rejects unknown stages, invalid dates, and unbounded task lists', () => {
    expect(careerDiaryPlanningSchema.safeParse({
      adaptationPlan: { ...plan, tasks: [{ ...task, stage: 'week-1' }] },
    }).success).toBe(false);
    expect(careerDiaryPlanningSchema.safeParse({
      adaptationPlan: { ...plan, tasks: [{ ...task, dueDate: '2026-13-90' }] },
    }).success).toBe(false);
    expect(careerDiaryPlanningSchema.safeParse({
      adaptationPlan: {
        ...plan,
        tasks: Array.from({ length: 101 }, (_, index) => ({ ...task, id: `task-${index}` })),
      },
    }).success).toBe(false);
  });
});
