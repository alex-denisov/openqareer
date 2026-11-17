import { describe, expect, it } from 'vitest';
import type { CareerDiaryGoalSummary } from '../../shared/careerDiary';
import {
  diaryWeekStart,
  isDiaryDate,
  shiftDiaryDate,
  type CareerDiaryEntry,
  type CareerDiaryWeekSummary,
} from '../../shared/careerDiaryEntries';
import { defaultAchieved, defaultBlockers, suggestWeekPlan } from './careerDiaryWeekDraft';

function entry(over: Partial<CareerDiaryEntry>): CareerDiaryEntry {
  return {
    id: 'e1',
    date: '2026-12-30',
    weekStart: '2026-12-28',
    kind: 'note',
    text: 'Текст',
    goalId: null,
    createdAt: '2026-12-30T10:00:00.000Z',
    updatedAt: '2026-12-30T10:00:00.000Z',
    ...over,
  };
}

function goal(over: Partial<CareerDiaryGoalSummary>): CareerDiaryGoalSummary {
  return {
    id: 'g1',
    title: 'Выпускать релиз за неделю',
    type: 'operational',
    horizon: 'quarter',
    startDate: '2026-12-01',
    dueDate: '2027-02-28',
    unit: 'дней',
    baselineValue: 14,
    targetValue: 7,
    valueSource: 'candidate_entered',
    parentGoalId: null,
    isPrimary: false,
    createdAt: '2026-12-01T00:00:00.000Z',
    updatedAt: '2026-12-01T00:00:00.000Z',
    latestMeasurement: null,
    risk: { status: 'on_track', rule: 'linear_progress_v1', explanation: '' },
    ...over,
  };
}

function summary(plan: CareerDiaryWeekSummary['plan']): CareerDiaryWeekSummary {
  return {
    weekStart: '2026-12-21',
    achievedEntryIds: [],
    achievedNotes: [],
    blockers: '',
    plan,
    createdAt: '2026-12-27T10:00:00.000Z',
    updatedAt: '2026-12-27T10:00:00.000Z',
  };
}

describe('недели дневника', () => {
  it('неделя начинается в понедельник, воскресенье относится к прошедшей', () => {
    expect(diaryWeekStart('2026-12-28')).toBe('2026-12-28');
    expect(diaryWeekStart('2027-01-03')).toBe('2026-12-28');
    expect(diaryWeekStart('2027-01-04')).toBe('2027-01-04');
    expect(diaryWeekStart('2026-02-31')).toBeNull();
    expect(diaryWeekStart('вчера')).toBeNull();
  });

  it('дата проверяется по календарю и сдвигается на дни', () => {
    expect(isDiaryDate('2028-02-29')).toBe(true);
    expect(isDiaryDate('2027-02-29')).toBe(false);
    expect(shiftDiaryDate('2027-01-04', -7)).toBe('2026-12-28');
  });
});

describe('черновик итога недели', () => {
  it('в «Что получилось» идут результаты и встречи, в «Что мешает» — проблемы', () => {
    const entries = [
      entry({ id: 'r', kind: 'result', text: 'Релиз за 5 дней.' }),
      entry({ id: 'p', kind: 'problem', text: 'Ждали тестовую среду 4 дня.' }),
      entry({ id: 'm', kind: 'meeting' }),
      entry({ id: 'n', kind: 'note' }),
      entry({ id: 'p2', kind: 'problem', text: 'Нет доступа к отчётам.' }),
    ];
    expect(defaultAchieved(entries)).toEqual(['r', 'm']);
    expect(defaultBlockers(entries)).toBe('Ждали тестовую среду 4 дня.\nНет доступа к отчётам.');
  });

  it('невыполненное обещание прошлой недели переносится первым, выполненное — нет', () => {
    const previous = summary([
      { text: 'Договориться о тестовой среде', goalId: 'g1', done: false },
      { text: 'Написать вакансию', goalId: null, done: true },
    ]);
    const plan = suggestWeekPlan({ goals: [], previous, weekStart: '2026-12-28' });
    expect(plan).toEqual([
      { text: 'Договориться о тестовой среде', goalId: 'g1', source: 'carried' },
    ]);
  });

  it('по целям: отстающая, затем без замера на этой неделе, затем остальные', () => {
    const measured = (at: string) => ({
      id: 'm',
      goalId: 'g',
      value: 5,
      measuredAt: at,
      note: null,
      source: 'candidate_entered' as const,
      createdAt: `${at}T10:00:00.000Z`,
    });
    const goals = [
      goal({ id: 'fresh', title: 'Свежий замер', latestMeasurement: measured('2026-12-29') }),
      goal({ id: 'stale', title: 'Давний замер', latestMeasurement: measured('2026-12-20') }),
      goal({
        id: 'risk',
        title: 'Отстаёт',
        risk: { status: 'at_risk', rule: 'linear_progress_v1', explanation: '' },
      }),
      goal({
        id: 'done',
        title: 'Достигнута',
        risk: { status: 'achieved', rule: 'target_reached', explanation: '' },
      }),
    ];
    const plan = suggestWeekPlan({ goals, previous: null, weekStart: '2026-12-28' });
    expect(plan).toEqual([
      { text: 'Разобрать, что мешает', goalId: 'risk', source: 'goal_at_risk' },
      { text: 'Внести замер', goalId: 'stale', source: 'goal_unmeasured' },
      { text: 'Сделать следующий шаг', goalId: 'fresh', source: 'goal' },
    ]);
  });

  it('цель с перенесённым обещанием второй раз не предлагается, цели вне недели — тоже', () => {
    const previous = summary([{ text: 'Разобрать, где ждёт релиз', goalId: 'g1', done: false }]);
    const goals = [
      goal({ id: 'g1' }),
      goal({ id: 'later', startDate: '2027-03-01', dueDate: '2027-05-31' }),
      goal({ id: 'past', startDate: '2026-09-01', dueDate: '2026-11-30' }),
    ];
    const plan = suggestWeekPlan({ goals, previous, weekStart: '2026-12-28' });
    expect(plan.map((item) => item.goalId)).toEqual(['g1']);
    expect(plan[0].source).toBe('carried');
  });

  it('предложений не больше семи', () => {
    const goals = Array.from({ length: 12 }, (_, index) => goal({ id: `g${index}` }));
    expect(suggestWeekPlan({ goals, previous: null, weekStart: '2026-12-28' })).toHaveLength(7);
  });
});
