import { describe, expect, it } from 'vitest';
import {
  EMPTY_ADAPTATION_DETAILS,
  type CareerDiaryAdaptationDetails,
} from '../../shared/careerDiaryCards';
import { buildAdaptationView, type PlanTask } from './careerDiaryAdaptationView';

function task(over: Partial<PlanTask>): PlanTask {
  return {
    id: 't1',
    title: 'Задача',
    description: '',
    stage: 'days_1_30',
    category: 'delivery',
    dueDate: '2026-12-15',
    completed: false,
    source: 'template',
    ...over,
  };
}

const workplace = { id: 'w1', startDate: '2026-12-01' };

function view(tasks: PlanTask[] | null, details: CareerDiaryAdaptationDetails, asOf = '2027-01-03') {
  return buildAdaptationView({ workplace, tasks, details, asOf });
}

describe('план адаптации для экрана d01', () => {
  it('отдаёт шесть шагов и четыре этапа даже без плана', () => {
    const result = view(null, EMPTY_ADAPTATION_DETAILS);
    expect(result.hasPlan).toBe(false);
    expect(result.steps.map((step) => step.id)).toEqual([
      'before_start',
      'first_two_weeks',
      'first_meeting',
      'people_map',
      'day_30_check',
      'settling',
    ]);
    expect(result.stages.map((stage) => stage.stage)).toEqual([
      'prep',
      'days_1_30',
      'days_31_60',
      'days_61_90',
    ]);
    expect(result.steps.every((step) => step.tasksTotal === 0 && step.status === 'ahead')).toBe(true);
  });

  it('день на новом месте считается от даты выхода', () => {
    expect(view(null, EMPTY_ADAPTATION_DETAILS, '2027-01-03').dayNumber).toBe(34);
    expect(view(null, EMPTY_ADAPTATION_DETAILS, '2026-12-01').dayNumber).toBe(1);
    // До выхода — сколько дней осталось, со знаком минус.
    expect(view(null, EMPTY_ADAPTATION_DETAILS, '2026-11-20').dayNumber).toBe(-11);
  });

  it('старый план читается без потерь: задачи встают в шаги по этапу и виду', () => {
    const tasks = [
      task({ id: 'prep', stage: 'prep', category: 'alignment' }),
      task({ id: 'people', stage: 'days_1_30', category: 'people' }),
      task({ id: 'align', stage: 'days_1_30', category: 'alignment', completed: true }),
      task({ id: 'delivery', stage: 'days_31_60', category: 'delivery' }),
    ];
    const result = view(tasks, EMPTY_ADAPTATION_DETAILS);
    const step = (id: string) => result.steps.find((item) => item.id === id)!;
    const ids = (id: string) => step(id).groups.flatMap((group) => group.tasks.map((t) => t.id));
    expect(ids('before_start')).toEqual(['prep']);
    expect(ids('first_two_weeks')).toEqual(['people']);
    expect(ids('first_meeting')).toEqual(['align']);
    expect(step('first_meeting')).toMatchObject({ tasksTotal: 1, tasksDone: 1, status: 'done' });
    // Задача без шага остаётся в своём этапе 30-60-90 и ни в один шаг не попадает.
    expect(result.steps.flatMap((item) => item.groups).flatMap((g) => g.tasks)).toHaveLength(3);
    expect(result.stages.flatMap((stage) => stage.tasks.map((t) => t.id))).toEqual([
      'prep',
      'people',
      'align',
      'delivery',
    ]);
  });

  it('шаг, группа и цель задачи берутся из деталей; группы идут в порядке появления', () => {
    const tasks = [
      task({ id: 'a', stage: 'prep' }),
      task({ id: 'b', stage: 'prep', completed: true }),
      task({ id: 'c', stage: 'prep' }),
      task({ id: 'd', stage: 'days_1_30', category: 'people' }),
    ];
    const details: CareerDiaryAdaptationDetails = {
      ...EMPTY_ADAPTATION_DETAILS,
      tasks: {
        a: { step: 'before_start', group: 'Уточнить у HR', goalId: null },
        b: { step: 'before_start', group: 'План первой недели', goalId: 'g1' },
        c: { step: 'before_start', group: 'Уточнить у HR', goalId: null },
        d: { step: 'settling', group: null, goalId: null },
        gone: { step: 'settling', group: null, goalId: null },
      },
    };
    const result = view(tasks, details);
    const before = result.steps[0];
    expect(before.groups.map((group) => [group.name, group.tasks.map((t) => t.id)])).toEqual([
      ['Уточнить у HR', ['a', 'c']],
      ['План первой недели', ['b']],
    ]);
    expect(before).toMatchObject({ tasksTotal: 3, tasksDone: 1, status: 'active' });
    expect(before.groups[1].tasks[0]).toMatchObject({ goalId: 'g1', step: 'before_start' });
    expect(result.steps[5].groups).toEqual([{ name: null, tasks: [expect.objectContaining({ id: 'd' })] }]);
    expect(result.steps[1].tasksTotal).toBe(0);
  });

  it('шаг по умолчанию: поле шага не названо — по этапу, `null` — ни в одном шаге', () => {
    const tasks = [task({ id: 'a', stage: 'prep' }), task({ id: 'b', stage: 'prep' })];
    const details: CareerDiaryAdaptationDetails = {
      ...EMPTY_ADAPTATION_DETAILS,
      tasks: { a: { goalId: 'g1' }, b: { step: null } },
    };
    const result = view(tasks, details);
    expect(result.steps[0].groups.flatMap((group) => group.tasks.map((t) => t.id))).toEqual(['a']);
    expect(result.steps[0].groups[0].tasks[0]).toMatchObject({ goalId: 'g1', group: null });
    expect(result.stages[0].tasks.find((t) => t.id === 'b')?.step).toBeNull();
  });

  it('пустой этап и пустой шаг — «впереди», даже если их дни начались', () => {
    const result = view([task({ id: 'a', stage: 'prep', completed: true })], EMPTY_ADAPTATION_DETAILS);
    expect(result.stages.map((stage) => stage.status)).toEqual(['done', 'ahead', 'ahead', 'ahead']);
  });

  it('статус этапа: всё сделано — готово, срок начался — в работе, иначе впереди', () => {
    const tasks = [
      task({ id: 'p', stage: 'prep', completed: true }),
      task({ id: 'a', stage: 'days_1_30', completed: true }),
      task({ id: 'b', stage: 'days_31_60' }),
      task({ id: 'c', stage: 'days_61_90' }),
    ];
    const details: CareerDiaryAdaptationDetails = {
      ...EMPTY_ADAPTATION_DETAILS,
      stages: { days_31_60: { title: 'Первый заметный результат', goalId: 'g1' } },
    };
    const result = view(tasks, details, '2027-01-03');
    expect(result.stages.map((stage) => stage.status)).toEqual(['done', 'done', 'active', 'ahead']);
    expect(result.stages[2]).toMatchObject({ title: 'Первый заметный результат', goalId: 'g1' });
    expect(result.stages[1]).toMatchObject({ title: null, goalId: null, tasksTotal: 1, tasksDone: 1 });
  });

  it('поля кандидата отдаются как сохранены', () => {
    const details: CareerDiaryAdaptationDetails = {
      ...EMPTY_ADAPTATION_DETAILS,
      probation: { endsOn: '2027-03-01', reviewer: 'Ирина Лаврова, директор по технологиям' },
      relocated: false,
    };
    const result = view([], details);
    expect(result.hasPlan).toBe(true);
    expect(result.probation).toEqual(details.probation);
    expect(result.relocated).toBe(false);
    expect(result.firstMeeting).toBeNull();
  });
});
