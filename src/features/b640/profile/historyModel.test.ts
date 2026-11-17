import { describe, expect, it } from 'vitest';
import type { ProfileHistoryItem } from '../../resume/profileHistoryApi';
import { canReapply, canRevert, historyDays, historyHeading, sourceLabel } from './historyModel';

function entry(overrides: Partial<ProfileHistoryItem>): ProfileHistoryItem {
  return {
    id: 'h1',
    actor: 'candidate',
    section: 'experience',
    kind: 'value',
    itemId: 'e1',
    label: '«Финтех Лаб» · размер команды',
    previousText: '8 человек',
    appliedText: '9 человек',
    createdAt: '2026-11-11T09:00:00.000Z',
    revertedAt: null,
    ...overrides,
  };
}

describe('b640 profile: история изменений', () => {
  it('заголовок считает правки', () => {
    expect(historyHeading(8)).toBe('8 правок профиля');
    expect(historyHeading(1)).toBe('1 правка профиля');
    expect(historyHeading(0)).toBe('Правок пока нет');
  });

  it('источник правки называет простым словом', () => {
    expect(sourceLabel('candidate')).toBe('вы');
    expect(sourceLabel('consultant')).toBe('консультант');
    expect(sourceLabel('import')).toBe('импорт');
    expect(sourceLabel('skill_check')).toBe('проверка навыков');
  });

  it('группирует по дням кандидата, новые сверху, порядок внутри дня сохраняет', () => {
    const days = historyDays(
      [
        entry({ id: 'a', createdAt: '2026-11-11T20:30:00.000Z' }),
        entry({ id: 'b', createdAt: '2026-11-11T09:00:00.000Z' }),
        entry({ id: 'c', createdAt: '2026-11-10T22:00:00.000Z' }),
      ],
      'Europe/Moscow',
    );
    // 22:00 UTC 10 ноября — это уже 11 ноября по Москве.
    expect(days.map((day) => [day.label, day.rows.map((row) => row.id)])).toEqual([
      ['11 ноября', ['a', 'b', 'c']],
    ]);
  });

  it('разные дни — разные группы', () => {
    const days = historyDays(
      [entry({ id: 'a' }), entry({ id: 'd', createdAt: '2026-11-02T09:00:00.000Z' })],
      'Europe/Moscow',
    );
    expect(days.map((day) => day.label)).toEqual(['11 ноября', '2 ноября']);
  });

  it('строка: что изменилось, было и стало; пустое «было» — прочерк', () => {
    const [day] = historyDays([entry({ previousText: '' })], 'UTC');
    expect(day.rows[0]).toMatchObject({
      what: '«Финтех Лаб» · размер команды',
      source: 'вы',
      was: '—',
      now: '9 человек',
      reverted: false,
      revertable: true,
      reappliable: false,
    });
  });

  it('отменить можно неотменённую правку значения, но не смену статуса', () => {
    expect(canRevert(entry({}))).toBe(true);
    expect(canRevert(entry({ revertedAt: '2026-11-12T00:00:00.000Z' }))).toBe(false);
    expect(canRevert(entry({ section: 'status' }))).toBe(false);
    expect(canRevert(entry({ section: 'photo' }))).toBe(false);
    expect(canRevert(entry({ section: 'income' }))).toBe(false);
  });

  it('вернуть можно отменённую правку значения профиля', () => {
    const reverted = { revertedAt: '2026-11-12T00:00:00.000Z' };
    expect(canReapply(entry(reverted))).toBe(true);
    expect(canReapply(entry({}))).toBe(false);
    expect(canReapply(entry({ ...reverted, kind: 'confirmation' }))).toBe(false);
    expect(canReapply(entry({ ...reverted, section: 'income' }))).toBe(false);
  });
});
