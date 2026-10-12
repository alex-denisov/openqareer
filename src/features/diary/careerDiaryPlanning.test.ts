import { describe, expect, it } from 'vitest';
import type { CareerDiaryGoalSummary, CareerDiaryWorkplace } from '../../../shared/careerDiary';
import {
  adaptationPlanProgress,
  addCareerDiaryAdaptationTask,
  canLaunchCareerDiaryAdaptationPlan,
  closeCareerDiaryAdaptationPlan,
  careerDiaryAdaptationPhase,
  careerDiaryQuarter,
  createCareerDiaryAdaptationPlan,
  summarizeCareerDiaryQuarter,
  setCareerDiaryAdaptationTaskCompleted,
} from './careerDiaryPlanning';

const workplace: CareerDiaryWorkplace = {
  id: 'workplace-1',
  company: 'Норма Групп',
  title: 'Head of Engineering',
  startDate: '2026-11-06',
  endDate: null,
  sourceExperienceId: null,
  status: 'active',
  isPrimary: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function goal(overrides: Partial<CareerDiaryGoalSummary> = {}): CareerDiaryGoalSummary {
  return {
    id: 'goal-1',
    title: 'Снизить число инцидентов P1',
    type: 'operational',
    horizon: 'quarter',
    startDate: '2026-10-01',
    dueDate: '2026-12-31',
    unit: 'инцидентов в месяц',
    baselineValue: 9,
    targetValue: 4,
    valueSource: 'candidate_entered',
    parentGoalId: null,
    isPrimary: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-12-01T00:00:00.000Z',
    latestMeasurement: {
      id: 'measurement-1',
      goalId: 'goal-1',
      value: 9,
      measuredAt: '2026-12-01',
      note: null,
      source: 'candidate_entered',
      createdAt: '2026-12-01T12:00:00.000Z',
    },
    risk: {
      status: 'at_risk',
      rule: 'linear_progress_v1',
      explanation: 'По вашим замерам цель не достигается в срок.',
    },
    ...overrides,
  };
}

describe('career diary quarterly planning', () => {
  it('uses the API date to derive the current and next calendar quarters', () => {
    expect(careerDiaryQuarter('2026-12-06')).toEqual({
      id: 'Q4 2026',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      nextId: 'Q1 2027',
      nextStartDate: '2027-01-01',
      nextEndDate: '2027-03-31',
    });
  });

  it('counts measured progress and keeps missing or stale values unknown', () => {
    const measuredBoolean = goal({
      id: 'goal-boolean',
      title: 'Согласовать бюджет на Q1',
      targetValue: true,
      baselineValue: null,
      unit: 'да/нет',
      latestMeasurement: {
        id: 'measurement-boolean',
        goalId: 'goal-boolean',
        value: true,
        measuredAt: '2026-11-20',
        note: null,
        source: 'candidate_entered',
        createdAt: '2026-11-20T12:00:00.000Z',
      },
    });
    const missing = goal({ id: 'goal-missing', latestMeasurement: null });
    const stale = goal({
      id: 'goal-stale',
      latestMeasurement: {
        id: 'measurement-stale',
        goalId: 'goal-stale',
        value: 8,
        measuredAt: '2026-09-30',
        note: null,
        source: 'candidate_entered',
        createdAt: '2026-09-30T12:00:00.000Z',
      },
    });
    const nextQuarter = goal({
      id: 'goal-next',
      horizon: 'next_quarter',
      dueDate: '2027-03-31',
    });

    expect(summarizeCareerDiaryQuarter([goal(), measuredBoolean, missing, stale, nextQuarter], '2026-12-06')).toMatchObject({
      goalCount: 4,
      achievedCount: 1,
      measuredCount: 2,
      unknownCount: 2,
      progressPercent: 50,
      freshMeasurementCount: 1,
    });
  });
});

describe('career diary adaptation plan', () => {
  it('derives offer, 30, 60 and 90 day states from the workplace date', () => {
    expect(careerDiaryAdaptationPhase({ ...workplace, startDate: '2026-12-20' }, '2026-12-06')).toBe('offer_accepted');
    expect(careerDiaryAdaptationPhase(workplace, '2026-12-06')).toBe('days_1_30');
    expect(careerDiaryAdaptationPhase({ ...workplace, startDate: '2026-10-18' }, '2026-12-06')).toBe('days_31_60');
    expect(careerDiaryAdaptationPhase({ ...workplace, startDate: '2026-09-10' }, '2026-12-06')).toBe('days_61_90');
    expect(careerDiaryAdaptationPhase({ ...workplace, startDate: '2026-08-01' }, '2026-12-06')).toBe('past_90');
    expect(careerDiaryAdaptationPhase({ ...workplace, status: 'archived' }, '2026-12-06')).toBe('archived');
  });

  it('allows launch only for an active workplace inside the first 90 days', () => {
    expect(canLaunchCareerDiaryAdaptationPlan(workplace, '2026-12-06')).toBe(true);
    expect(canLaunchCareerDiaryAdaptationPlan({ ...workplace, startDate: '2026-12-20' }, '2026-12-06')).toBe(true);
    expect(canLaunchCareerDiaryAdaptationPlan({ ...workplace, startDate: '2026-08-01' }, '2026-12-06')).toBe(false);
    expect(canLaunchCareerDiaryAdaptationPlan({ ...workplace, status: 'archived' }, '2026-12-06')).toBe(false);
  });

  it('creates persisted-template tasks and reports stage progress', () => {
    let id = 0;
    const plan = createCareerDiaryAdaptationPlan(workplace, '2026-12-06T12:00:00.000Z', () => `task-${++id}`);
    expect(plan).toMatchObject({
      workplaceId: workplace.id,
      status: 'active',
      closedAt: null,
    });
    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(new Set(plan.tasks.map((task) => task.id)).size).toBe(plan.tasks.length);
    expect(adaptationPlanProgress(plan)).toEqual({ completed: 0, total: plan.tasks.length });
    expect(adaptationPlanProgress(plan, 'prep').total).toBeGreaterThan(0);
  });

  it('adds candidate tasks, records completion, and closes the plan', () => {
    let id = 0;
    const plan = createCareerDiaryAdaptationPlan(workplace, '2026-12-06T12:00:00.000Z', () => `id-${++id}`);
    const firstTask = plan.tasks[0]!;
    const completed = setCareerDiaryAdaptationTaskCompleted(plan, firstTask.id, true);
    expect(completed.tasks[0]?.completed).toBe(true);

    const withNewTask = addCareerDiaryAdaptationTask(completed, {
      title: 'Согласовать критерии успеха',
      description: 'Записать договорённости с руководителем.',
      stage: 'days_31_60',
      dueDate: '2026-12-20',
    }, () => 'candidate-task');
    expect(withNewTask.tasks.at(-1)).toMatchObject({
      id: 'candidate-task',
      source: 'candidate',
      completed: false,
      stage: 'days_31_60',
    });
    expect(adaptationPlanProgress(withNewTask)).toEqual({
      completed: 1,
      total: plan.tasks.length + 1,
    });

    expect(closeCareerDiaryAdaptationPlan(withNewTask, '2026-12-06T18:00:00.000Z')).toMatchObject({
      status: 'closed',
      closedAt: '2026-12-06T18:00:00.000Z',
    });
    expect(() => addCareerDiaryAdaptationTask(withNewTask, {
      title: '  ',
      description: '',
      stage: 'prep',
      dueDate: '2026-11-06',
    })).toThrow();
  });
});
