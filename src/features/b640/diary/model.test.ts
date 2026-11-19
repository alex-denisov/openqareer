import { describe, expect, it } from 'vitest';
import type {
  CareerDiaryEntry,
  CareerDiaryWeekSummary,
} from '../../../../shared/careerDiaryEntries';
import {
  groupByWeek,
  kindView,
  nearestDue,
  shortDate,
  summaryBody,
  summaryHeadline,
  weekNumber,
  weekRange,
  weekRangeLong,
  weekdayDate,
} from './model';

const entry = (id: string, date: string, weekStart: string, text = id): CareerDiaryEntry => ({
  id,
  date,
  weekStart,
  kind: 'result',
  text,
  goalId: null,
  createdAt: `${date}T10:00:00.000Z`,
  updatedAt: `${date}T10:00:00.000Z`,
});

const summary = (
  weekStart: string,
  ids: string[],
  notes: string[] = [],
  blockers = '',
): CareerDiaryWeekSummary => ({
  weekStart,
  achievedEntryIds: ids,
  achievedNotes: notes,
  blockers,
  plan: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('даты дневника', () => {
  it('короткая дата и день недели', () => {
    expect(shortDate('2026-01-03')).toBe('3 янв');
    expect(weekdayDate('2026-01-15')).toBe('Чт, 15 янв');
  });

  it('неделя в одном месяце и на стыке месяцев', () => {
    expect(weekRange('2025-12-22')).toBe('22–28 дек');
    expect(weekRange('2025-12-29')).toBe('29 дек — 4 янв');
    expect(weekRangeLong('2025-12-29')).toBe('29 декабря — 4 января');
    expect(weekRangeLong('2026-01-05')).toBe('5–11 января');
  });

  it('номер недели от начала дневника; без начала номера нет', () => {
    expect(weekNumber('2025-12-01', '2025-12-03')).toBe(1);
    expect(weekNumber('2025-12-29', '2025-12-03')).toBe(5);
    expect(weekNumber('2025-11-24', '2025-12-03')).toBeNull();
    expect(weekNumber('2025-12-29', null)).toBeNull();
  });
});

describe('лента по неделям', () => {
  it('новые недели сверху, текущая неделя есть даже без записей', () => {
    const entries = [
      entry('a', '2025-12-24', '2025-12-22'),
      entry('b', '2025-12-15', '2025-12-15'),
    ];
    const groups = groupByWeek(entries, [summary('2025-12-22', ['a'])], '2025-12-29');
    expect(groups.map((group) => group.weekStart)).toEqual([
      '2025-12-29',
      '2025-12-22',
      '2025-12-15',
    ]);
    expect(groups[0].entries).toEqual([]);
    expect(groups[1].summary?.achievedEntryIds).toEqual(['a']);
    expect(groups[2].summary).toBeNull();
  });

  it('итог недели: заголовок по первому пункту, тело — остальное и что мешает', () => {
    const entries = [
      entry('a', '2025-12-24', '2025-12-22', 'Релиз 7 дней'),
      entry('b', '2025-12-23', '2025-12-22', 'Встреча'),
    ];
    const saved = summary('2025-12-22', ['a', 'b'], ['Сам дописал'], 'Тестовая среда');
    expect(summaryHeadline(saved, entries)).toBe('Итог недели: Релиз 7 дней');
    expect(summaryBody(saved, entries)).toBe(
      'Получилось: Встреча Сам дописал Мешает: Тестовая среда',
    );
    expect(summaryHeadline(summary('2025-12-22', []), entries)).toBe('Итог недели подведён');
  });
});

describe('прочее', () => {
  it('метка вида записи из макета', () => {
    expect(kindView('problem')).toMatchObject({ tag: 'проблема', tagClass: 'tag part' });
    expect(kindView('note').tagClass).toBe('tag miss');
  });

  it('ближайший срок цели не раньше сегодня', () => {
    const goals = [
      { title: 'A', dueDate: '2026-01-10' },
      { title: 'B', dueDate: '2026-03-31' },
      { title: 'C', dueDate: '2026-02-01' },
    ];
    expect(nearestDue(goals, '2026-01-11')?.title).toBe('C');
    expect(nearestDue(goals, '2026-04-01')).toBeNull();
  });
});
