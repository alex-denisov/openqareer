import { describe, expect, it } from 'vitest';
import { todayTitle } from './index';

describe('todayTitle (B772)', () => {
  it('адрес консультанта называет консультанта, остальные — свой раздел', () => {
    expect(todayTitle('s03', true)).toBe('Консультант');
    expect(todayTitle('s03', false)).toBe('Сегодня');
    expect(todayTitle('n01b', false)).toBe('Уведомления');
  });
});
