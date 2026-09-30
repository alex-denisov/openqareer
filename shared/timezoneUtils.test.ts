import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  inferTimezoneFromRegionOrLabel,
  isValidTimezone,
} from './timezoneUtils';

describe('timezoneUtils (B328)', () => {
  it('validates IANA timezones correctly', () => {
    expect(isValidTimezone('Europe/Moscow')).toBe(true);
    expect(isValidTimezone('Europe/Berlin')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Asia/Nicosia')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);

    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('invalid')).toBe(false);
    expect(isValidTimezone(null)).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });

  it('infers timezones from regional names and account labels', () => {
    expect(inferTimezoneFromRegionOrLabel('Лимасол, Кипр')).toBe('Asia/Nicosia');
    expect(inferTimezoneFromRegionOrLabel('Cyprus-Scout')).toBe('Asia/Nicosia');
    expect(inferTimezoneFromRegionOrLabel('Германия (Берлин)')).toBe('Europe/Berlin');
    expect(inferTimezoneFromRegionOrLabel('DE Pool 1')).toBe('Europe/Berlin');
    expect(inferTimezoneFromRegionOrLabel('Амстердам, Нидерланды')).toBe('Europe/Amsterdam');
    expect(inferTimezoneFromRegionOrLabel('UK Recruiter')).toBe('Europe/London');
    expect(inferTimezoneFromRegionOrLabel('Сербия, Белград')).toBe('Europe/Belgrade');
    expect(inferTimezoneFromRegionOrLabel('Дубай, ОАЭ')).toBe('Asia/Dubai');
    expect(inferTimezoneFromRegionOrLabel('Армения')).toBe('Asia/Yerevan');
    expect(inferTimezoneFromRegionOrLabel('Тбилиси, Грузия')).toBe('Asia/Tbilisi');
    expect(inferTimezoneFromRegionOrLabel('Казахстан (Алматы)')).toBe('Asia/Almaty');
    expect(inferTimezoneFromRegionOrLabel('США (Нью-Йорк)')).toBe('America/New_York');
    expect(inferTimezoneFromRegionOrLabel('Калифорния, США')).toBe('America/Los_Angeles');
    expect(inferTimezoneFromRegionOrLabel('Москва, Россия')).toBe('Europe/Moscow');

    // Прямой IANA пояс в лейбле
    expect(inferTimezoneFromRegionOrLabel('Asia/Tokyo')).toBe('Asia/Tokyo');

    // Неизвестный регион -> дефолт Europe/Moscow
    expect(inferTimezoneFromRegionOrLabel('Unknown Territory')).toBe(DEFAULT_ACCOUNT_TIMEZONE);
    expect(inferTimezoneFromRegionOrLabel(null)).toBe(DEFAULT_ACCOUNT_TIMEZONE);
  });
});

describe('timezoneUtils (B332)', () => {
  it('contains the immutable list of 25 common timezones in order', async () => {
    const { COMMON_TIMEZONES } = await import('./timezoneUtils');
    expect(COMMON_TIMEZONES).toHaveLength(25);
    expect(COMMON_TIMEZONES[0]).toEqual({ city: 'Москва', timezone: 'Europe/Moscow' });
    expect(COMMON_TIMEZONES[1]).toEqual({ city: 'Калининград', timezone: 'Europe/Kaliningrad' });
    expect(COMMON_TIMEZONES[24]).toEqual({ city: 'Бангкок', timezone: 'Asia/Bangkok' });

    for (const item of COMMON_TIMEZONES) {
      expect(isValidTimezone(item.timezone), `${item.timezone} must be valid`).toBe(true);
    }
  });

  it('calculates offsets dynamically including positive, negative, and zero (UTC)', async () => {
    const { formatTimezoneOffset } = await import('./timezoneUtils');
    expect(formatTimezoneOffset('Europe/Moscow')).toBe('UTC+3');
    expect(formatTimezoneOffset('UTC')).toBe('UTC');
    // Отрицательные смещения США
    expect(formatTimezoneOffset('America/New_York')).toMatch(/^UTC[-−]\d+/);
    expect(formatTimezoneOffset('America/Los_Angeles')).toMatch(/^UTC[-−]\d+/);
  });

  it('formats timezone display for admin cards and labels', async () => {
    const { formatTimezoneDisplay } = await import('./timezoneUtils');
    expect(formatTimezoneDisplay('Europe/Moscow')).toBe('Москва (UTC+3)');
    expect(formatTimezoneDisplay(null)).toBe('Москва (UTC+3)');
    expect(formatTimezoneDisplay(undefined)).toBe('Москва (UTC+3)');
    expect(formatTimezoneDisplay('')).toBe('Москва (UTC+3)');
    expect(formatTimezoneDisplay('Asia/Tokyo')).toMatch(/^Asia\/Tokyo \(UTC\+9\)$/);
  });

  it('extracts city name from known list or timezone string', async () => {
    const { getTimezoneCity } = await import('./timezoneUtils');
    expect(getTimezoneCity('Europe/Moscow')).toBe('Москва');
    expect(getTimezoneCity('Europe/Kaliningrad')).toBe('Калининград');
    expect(getTimezoneCity('Asia/Tokyo')).toBe('Tokyo');
  });
});
