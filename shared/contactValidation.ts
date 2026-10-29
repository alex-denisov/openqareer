/**
 * Contact-field rules for the candidate profile. Pure functions with no React
 * and no DOM: the profile form and `server/domain/resumeDraft.ts` run the same
 * check, so the two can never disagree about what a valid phone is.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/u;
const MAX_EMAIL_LENGTH = 320;
const MIN_PHONE_DIGITS = 10;
const MAX_PHONE_DIGITS = 15;
const RUSSIAN_PHONE_DIGITS = 11;

export const PHONE_ERROR_TEXT =
  'Телефон: укажите номер целиком, например +7 999 123-45-67, или с кодом страны.';
export const EMAIL_ERROR_TEXT = 'Email: проверьте адрес, например name@mail.ru.';

export function getContactEmailError(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(trimmed)) return EMAIL_ERROR_TEXT;
  return null;
}

function digitsOf(input: string): string {
  return input.replace(/\D/gu, '');
}

function isRussian(input: string, digits: string): boolean {
  const trimmed = input.trim();
  if (trimmed.startsWith('+')) return digits.startsWith('7');
  return digits.startsWith('8') || digits.startsWith('7') || digits.startsWith('9');
}

function russianDigits(digits: string): string {
  const national = digits.startsWith('7') || digits.startsWith('8') ? digits.slice(1) : digits;
  return national.slice(0, 10);
}

function formatRussian(national: string): string {
  const [a, b, c, d] = [
    national.slice(0, 3),
    national.slice(3, 6),
    national.slice(6, 8),
    national.slice(8, 10),
  ];
  return `+7${a ? ` ${a}` : ''}${b ? ` ${b}` : ''}${c ? `-${c}` : ''}${d ? `-${d}` : ''}`;
}

function formatInternational(digits: string): string {
  const codeLength = digits.startsWith('1') || digits.startsWith('7') ? 1 : 2;
  const rest = digits.slice(codeLength, MAX_PHONE_DIGITS);
  const groups = rest.match(/\d{1,3}/gu) ?? [];
  return ['+' + digits.slice(0, codeLength), ...groups].join(' ');
}

/** Autoformat while typing: +7 XXX XXX-XX-XX for Russian, grouped digits otherwise. */
export function formatPhoneInput(input: string): string {
  const digits = digitsOf(input);
  if (!digits) return input.trim().startsWith('+') ? '+' : '';
  if (isRussian(input, digits)) return formatRussian(russianDigits(digits));
  return formatInternational(digits);
}

export function getContactPhoneError(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;
  if (/[^\d\s()+\-.]/u.test(trimmed)) return PHONE_ERROR_TEXT;
  const digits = digitsOf(trimmed);
  if (isRussian(trimmed, digits)) {
    const full = digits.length === 10 ? `7${digits}` : digits.replace(/^8/u, '7');
    return full.length === RUSSIAN_PHONE_DIGITS ? null : PHONE_ERROR_TEXT;
  }
  const valid = digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
  return valid ? null : PHONE_ERROR_TEXT;
}
