import { describe, expect, it } from 'vitest';
import type { CareerDiaryGoal, CareerDiaryMeasurement } from '../../../shared/careerDiary';
import {
  groupGoalsByHorizon,
  numericMeasurementsForChart,
  isDueDateBeforeStart,
} from './careerDiaryModel';

function goal(
  id: string,
  horizon: CareerDiaryGoal['horizon'],
  dueDate: string,
): CareerDiaryGoal {
  return {
    id,
    title: id,
    type: 'operational',
    horizon,
    startDate: '2026-01-01',
    dueDate,
    unit: 'инцидентов в месяц',
    baselineValue: 10,
    targetValue: 4,
    valueSource: 'candidate_entered',
    parentGoalId: null,
    isPrimary: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function measurement(
  id: string,
  measuredAt: string,
  value: CareerDiaryMeasurement['value'],
): CareerDiaryMeasurement {
  return {
    id,
    goalId: 'goal-1',
    value,
    measuredAt,
    note: null,
    source: 'candidate_entered',
    createdAt: measuredAt + 'T12:00:00.000Z',
  };
}

describe('career diary goal presentation model', () => {
  it('groups goals by horizon in the planned order and sorts each group by due date', () => {
    const goals = [
      goal('year-goal', 'year', '2027-12-31'),
      goal('later-quarter-goal', 'quarter', '2026-12-31'),
      goal('next-quarter-goal', 'next_quarter', '2027-03-31'),
      goal('earlier-quarter-goal', 'quarter', '2026-09-30'),
    ];

    expect(groupGoalsByHorizon(goals)).toEqual([
      { horizon: 'quarter', goals: [goals[3], goals[1]] },
      { horizon: 'next_quarter', goals: [goals[2]] },
      { horizon: 'year', goals: [goals[0]] },
    ]);
  });

  it('returns only dated numeric measurements for a numeric chart', () => {
    const points = [
      measurement('later', '2026-02-02', 8),
      measurement('unquantified', '2026-01-10', 'согласован'),
      measurement('earlier', '2026-01-03', 9),
    ];

    expect(numericMeasurementsForChart(points)).toEqual([
      { date: '2026-01-03', value: 9 },
      { date: '2026-02-02', value: 8 },
    ]);
    expect(numericMeasurementsForChart([measurement('text', '2026-01-01', true)])).toBeNull();
  });

  it('identifies a due date earlier than the goal start date', () => {
    expect(isDueDateBeforeStart('2026-03-01', '2026-02-28')).toBe(true);
    expect(isDueDateBeforeStart('2026-02-01', '2026-02-28')).toBe(false);
  });
});
