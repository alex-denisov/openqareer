import { describe, expect, it } from 'vitest';
import { formatPhoneInput, getContactEmailError, getContactPhoneError } from './contactValidation';

describe('formatPhoneInput', () => {
  it('formats Russian numbers as +7 XXX XXX-XX-XX', () => {
    expect(formatPhoneInput('89991234567')).toBe('+7 999 123-45-67');
    expect(formatPhoneInput('+7 (999) 123 45 67')).toBe('+7 999 123-45-67');
    expect(formatPhoneInput('9991234567')).toBe('+7 999 123-45-67');
  });
  it('formats partial Russian input while typing', () => {
    expect(formatPhoneInput('8999')).toBe('+7 999');
    expect(formatPhoneInput('+7 9991')).toBe('+7 999 1');
  });
  it('keeps the country code of international numbers and groups digits', () => {
    expect(formatPhoneInput('+4915112345678')).toBe('+49 151 123 456 78');
    expect(formatPhoneInput('+1 202 555 0143')).toBe('+1 202 555 014 3');
  });
  it('leaves empty input empty', () => {
    expect(formatPhoneInput('')).toBe('');
  });
});

describe('getContactPhoneError', () => {
  it('accepts empty and well-formed numbers', () => {
    expect(getContactPhoneError('')).toBeNull();
    expect(getContactPhoneError('+7 999 123-45-67')).toBeNull();
    expect(getContactPhoneError('+49 151 123 456 78')).toBeNull();
  });
  it('rejects short and overlong numbers with a specific message', () => {
    expect(getContactPhoneError('+7 999 12')).toMatch(/Телефон/u);
    expect(getContactPhoneError('+7 999 123-45-6789')).toMatch(/Телефон/u);
    expect(getContactPhoneError('12345')).toMatch(/Телефон/u);
  });
});

describe('getContactEmailError', () => {
  it('accepts empty, plus-aliases and normal addresses', () => {
    expect(getContactEmailError('')).toBeNull();
    expect(getContactEmailError('a.b+c@mail.ru')).toBeNull();
  });
  it('rejects malformed addresses', () => {
    expect(getContactEmailError('abc')).toMatch(/Email/u);
    expect(getContactEmailError('a@b')).toMatch(/Email/u);
  });
});
