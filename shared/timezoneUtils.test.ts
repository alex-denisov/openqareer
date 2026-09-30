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
