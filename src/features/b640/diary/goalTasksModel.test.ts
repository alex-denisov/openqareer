import { describe, expect, it } from 'vitest';
import type { CareerDiaryAdaptationView } from '../../../../shared/careerDiaryCards';
import type { CareerDiaryWorkplaceWithPlanning } from '../../diary/careerDiaryPlanning';
import { goalTasks, taskWhen, withGoalTask } from './goalTasksModel';

const task = (id: string, goalId: string | null, dueDate = '2027-01-14') => ({
  id,
  title: `Задача ${id}`,
  description: '',
  stage: 'days_1_30' as const,
  dueDate,
  completed: false,
  source: 'candidate' as const,
  step: null,
  group: null,
  goalId,
});

const view = {
  stages: [
    { stage: 'prep', tasks: [task('t1', 'g1'), task('t2', null)] },
    { stage: 'days_1_30', tasks: [task('t3', 'g2'), task('t4', 'g1', '2027-01-20')] },
  ],
} as unknown as CareerDiaryAdaptationView;

const workplace = {
  id: 'w1',
  company: 'Вектор Банк',
  title: 'Руководитель разработки',
  startDate: '2026-12-15',
  planning: null,
} as unknown as CareerDiaryWorkplaceWithPlanning;

describe('B743: задачи цели', () => {
  it('задачи плана с этой целью — в порядке плана; срок «до 14 янв»', () => {
    const found = goalTasks(view, 'g1');
    expect(found.map((item) => item.id)).toEqual(['t1', 't4']);
    expect(taskWhen(found[0]!)).toBe('до 14 янв');
    expect(goalTasks(view, 'g9')).toEqual([]);
  });

  it('плана нет — пустой план с одной задачей кандидата, без задач шаблона', () => {
    let n = 0;
    const { plan, taskId } = withGoalTask(
      workplace,
      { title: ' Созвон с отделом найма ', dueDate: '2027-01-10' },
      '2026-12-20T12:00:00.000Z',
      () => `id-${(n += 1)}`,
    );
    expect(plan.workplaceId).toBe('w1');
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      id: taskId,
      title: 'Созвон с отделом найма',
      dueDate: '2027-01-10',
      completed: false,
    });
  });

  it('план есть — задача дописывается в конец, прежние не меняются', () => {
    const first = withGoalTask(
      workplace,
      { title: 'Первая', dueDate: '2027-01-10' },
      '2026-12-20T12:00:00.000Z',
    );
    const withPlan = {
      ...workplace,
      planning: { adaptationPlan: first.plan },
    } as unknown as CareerDiaryWorkplaceWithPlanning;
    const second = withGoalTask(
      withPlan,
      { title: 'Вторая', dueDate: '2027-01-20' },
      '2026-12-21T12:00:00.000Z',
    );
    expect(second.plan.id).toBe(first.plan.id);
    expect(second.plan.tasks.map((item) => item.title)).toEqual(['Первая', 'Вторая']);
    expect(second.taskId).not.toBe(first.taskId);
  });
});
