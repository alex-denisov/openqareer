import { describe, expect, it } from 'vitest';
import type { CareerDiaryGoalCard } from '../../../../shared/careerDiaryCards';
import type { CareerDiaryWeekDraft } from '../../../../shared/careerDiaryEntries';
import {
  changedMeters,
  initialForm,
  meterFields,
  planSourceText,
  summaryInput,
  weekFromSearch,
} from './weekModel';

const goal = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Цель ${id}`,
  unit: '',
  baselineValue: 10,
  targetValue: 5,
  latestMeasurement: null,
  indicators: [],
  ...extra,
});

const cards = [
  goal('a', { unit: '%', latestMeasurement: { value: 8, measuredAt: '2026-01-07' } }),
  goal('b', {
    indicators: [
      goal('b1', { latestMeasurement: { value: 3, measuredAt: '2025-12-30T09:00:00Z' } }),
    ],
  }),
  goal('c', { targetValue: 'да' }),
] as unknown as CareerDiaryGoalCard[];

const draft: CareerDiaryWeekDraft = {
  weekStart: '2025-12-29',
  entries: [],
  achievedEntryIds: ['x', 'y'],
  blockers: 'мешает',
  plan: [
    { text: 'Обещание', goalId: null, source: 'carried' },
    { text: 'По цели', goalId: 'b1', source: 'goal' },
  ],
  saved: null,
};

describe('итог недели: модель', () => {
  it('неделя из адреса — только понедельник', () => {
    expect(weekFromSearch('?week=2025-12-29', 'F')).toBe('2025-12-29');
    expect(weekFromSearch('?week=2025-12-30', 'F')).toBe('F');
    expect(weekFromSearch('', 'F')).toBe('F');
  });

  it('замеры: числовые показатели, «было» до недели, замер этой недели в поле', () => {
    const fields = meterFields(cards, '2025-12-29');
    expect(fields.map((field) => field.goalId)).toEqual(['a', 'b1']);
    expect(fields[0]).toMatchObject({ label: 'Цель a, %', placeholder: 'было 8', value: '' });
    expect(fields[1]).toMatchObject({ placeholder: 'было 10', value: '3' });
  });

  it('форма из черновика и обратно; изменённые замеры', () => {
    const form = initialForm(draft, cards);
    expect(form.plan.map((row) => row.goalTitle)).toEqual([null, 'Цель b']);
    const edited = {
      ...form,
      hiddenIds: ['y'],
      notes: [' своё ', ''],
      plan: form.plan.map((row, index) => ({ ...row, kept: index === 1 })),
      meters: { ...form.meters, a: '7,5', b1: '3' },
    };
    expect(summaryInput(edited)).toEqual({
      achievedEntryIds: ['x'],
      achievedNotes: ['своё'],
      blockers: 'мешает',
      plan: [{ text: 'По цели', goalId: 'b1', done: false }],
    });
    expect(changedMeters(edited, form)).toEqual([{ goalId: 'a', value: 7.5 }]);
  });

  it('B683: единица из названия не повторяется в подписи замера', () => {
    const named = [
      goal('r', { title: 'Срок релиза, дней', unit: 'дней' }),
    ] as unknown as CareerDiaryGoalCard[];
    expect(meterFields(named, '2025-12-29')[0]?.label).toBe('Срок релиза, дней');
  });

  it('B683: у цели с несколькими показателями пункт плана называет показатель', () => {
    const many = [
      goal('m', { indicators: [goal('m1'), goal('m2')] }),
    ] as unknown as CareerDiaryGoalCard[];
    const twoRows = {
      ...draft,
      plan: [
        { text: 'Внести замер', goalId: 'm1', source: 'goal_unmeasured' as const },
        { text: 'Внести замер', goalId: 'm2', source: 'goal_unmeasured' as const },
      ],
    };
    expect(initialForm(twoRows, many).plan.map((row) => row.goalTitle)).toEqual([
      'Цель m1',
      'Цель m2',
    ]);
  });

  it('сохранённый итог побеждает предложение', () => {
    const saved = {
      ...draft,
      saved: {
        weekStart: '2025-12-29',
        achievedEntryIds: ['x'],
        achievedNotes: ['n'],
        blockers: 'b',
        plan: [{ text: 'P', goalId: null, done: true }],
        createdAt: '',
        updatedAt: '',
      },
    };
    const form = initialForm(saved, cards);
    expect(form).toMatchObject({ achievedIds: ['x'], notes: ['n'], blockers: 'b' });
    expect(summaryInput(form).plan).toEqual([{ text: 'P', goalId: null, done: true }]);
  });

  it('ⓘ плана называет перенос обещания', () => {
    expect(planSourceText(draft)).toContain('перенесено');
    expect(planSourceText({ ...draft, plan: [] })).not.toContain('перенесено');
  });
});
