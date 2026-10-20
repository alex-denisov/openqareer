import { describe, expect, it } from 'vitest';
import {
  adaptationTaskOrigin,
  formatDayMonth,
  nearestAdaptationTask,
  nearestDueCopy,
} from './careerDiaryAdaptationView';
import type { CareerDiaryAdaptationTask } from './careerDiaryPlanning';

function task(overrides: Partial<CareerDiaryAdaptationTask> = {}): CareerDiaryAdaptationTask {
  return {
    id: 'task-1',
    title: 'Реализация первой быстрой победы',
    description: '',
    stage: 'days_31_60',
    category: 'delivery',
    dueDate: '2026-12-20',
    completed: false,
    source: 'template',
    ...overrides,
  };
}

describe('formatDayMonth', () => {
  it('prints day and month with leading zeros, as in the approved mockup', () => {
    expect(formatDayMonth('2026-12-20')).toBe('20.12');
    expect(formatDayMonth('2027-01-02')).toBe('02.01');
  });

  it('returns the raw value when the date cannot be read', () => {
    expect(formatDayMonth('скоро')).toBe('скоро');
  });
});

describe('nearestAdaptationTask', () => {
  it('picks the open task with the earliest due date across all stages', () => {
    const tasks = [
      task({ id: 'late', dueDate: '2026-12-29' }),
      task({ id: 'done', dueDate: '2026-12-01', completed: true }),
      task({ id: 'soon', dueDate: '2026-12-20', stage: 'days_61_90' }),
    ];
    expect(nearestAdaptationTask(tasks)?.id).toBe('soon');
  });

  it('returns null when every task is done', () => {
    expect(nearestAdaptationTask([task({ completed: true })])).toBeNull();
  });
});

describe('nearestDueCopy', () => {
  it('counts days to the due date with Russian plural forms', () => {
    expect(nearestDueCopy('2026-12-20', '2026-12-06')).toBe('Срок через 14 дней.');
    expect(nearestDueCopy('2026-12-07', '2026-12-06')).toBe('Срок через 1 день.');
    expect(nearestDueCopy('2026-12-09', '2026-12-06')).toBe('Срок через 3 дня.');
  });

  it('names today and overdue tasks plainly', () => {
    expect(nearestDueCopy('2026-12-06', '2026-12-06')).toBe('Срок сегодня.');
    expect(nearestDueCopy('2026-12-01', '2026-12-06')).toBe('Срок прошёл 5 дней назад.');
  });
});

describe('adaptationTaskOrigin', () => {
  it('names where each task came from', () => {
    expect(adaptationTaskOrigin(task())).toBe('из шаблона');
    expect(adaptationTaskOrigin(task({ source: 'candidate' }))).toBe('добавлено вами');
    expect(adaptationTaskOrigin(task({ id: 'coach-abc', source: 'candidate' }))).toBe(
      'добавлено консультантом',
    );
  });
});
