import { describe, expect, it } from 'vitest';
import { wantsMoreRows } from './useVacancyList';

const base = { serverMode: true, narrowed: true, loaded: 20, found: 1, wanted: 20 };

describe('дочитывание подборки под клиентский фильтр (s07, Н-А)', () => {
  it('подошла одна строка из двадцати — читаем дальше', () => {
    expect(wantsMoreRows(base)).toBe(true);
  });

  it('ничего не подошло — читаем дальше и без клиентского фильтра', () => {
    expect(wantsMoreRows({ ...base, narrowed: false, found: 0 })).toBe(true);
  });

  it('порция набралась — останавливаемся', () => {
    expect(wantsMoreRows({ ...base, found: 20 })).toBe(false);
  });

  it('фильтра нет, до первой порции или подборка целиком — не читаем', () => {
    expect(wantsMoreRows({ ...base, narrowed: false })).toBe(false);
    expect(wantsMoreRows({ ...base, loaded: 0, found: 0 })).toBe(false);
    expect(wantsMoreRows({ ...base, serverMode: false })).toBe(false);
  });
});
