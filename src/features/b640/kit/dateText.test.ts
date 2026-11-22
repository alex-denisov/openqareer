import { describe, expect, it } from 'vitest';
import { formatDateTyping, isoToRuDate, readRuDate } from './dateText';

describe('dateText: «дд.мм.гггг» на экране, ISO в API (B733)', () => {
  it('ISO показывается как дд.мм.гггг, пустое и битое — пустой строкой', () => {
    expect(isoToRuDate('2026-12-01')).toBe('01.12.2026');
    expect(isoToRuDate('')).toBe('');
    expect(isoToRuDate('01.12.2026')).toBe('');
  });

  it('полная дата читается в ISO', () => {
    expect(readRuDate('01.12.2026')).toEqual({ iso: '2026-12-01' });
    expect(readRuDate('1.2.2027')).toEqual({ iso: '2027-02-01' });
    expect(readRuDate(' 29.02.2028 ')).toEqual({ iso: '2028-02-29' });
  });

  it('пусто — пустое значение без ошибки', () => {
    expect(readRuDate('')).toEqual({ iso: '' });
    expect(readRuDate('   ')).toEqual({ iso: '' });
  });

  it('несуществующая или неполная дата — ошибка формата', () => {
    for (const bad of [
      '31.02.2026',
      '29.02.2027',
      '12.2026',
      '01/12/2026',
      '2026-12-01',
      '00.01.2026',
      '1.13.2026',
    ]) {
      expect(readRuDate(bad), bad).toEqual({ iso: '', error: 'Дата в виде дд.мм.гггг' });
    }
  });

  it('дата позже допустимой — своя ошибка', () => {
    expect(readRuDate('23.11.2026', '2026-11-22')).toEqual({
      iso: '',
      error: 'Не позже 22.11.2026',
    });
    expect(readRuDate('22.11.2026', '2026-11-22')).toEqual({ iso: '2026-11-22' });
  });

  it('при наборе цифр точки ставятся сами', () => {
    expect(formatDateTyping('0')).toBe('0');
    expect(formatDateTyping('011')).toBe('01.1');
    expect(formatDateTyping('01122026')).toBe('01.12.2026');
    expect(formatDateTyping('01.12.2026')).toBe('01.12.2026');
    expect(formatDateTyping('011220269')).toBe('01.12.2026');
  });

  it('ручные точки и короткий день не ломаются', () => {
    expect(formatDateTyping('1.2.2027')).toBe('1.2.2027');
    expect(formatDateTyping('1.')).toBe('1.');
    expect(formatDateTyping('01.122')).toBe('01.12.2');
    expect(formatDateTyping('01.12.20261')).toBe('01.12.2026');
    expect(formatDateTyping('')).toBe('');
  });
});
