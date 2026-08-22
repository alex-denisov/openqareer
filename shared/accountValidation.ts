/**
 * Field rules for account forms, ported from the eterapy platform at the
 * owner's request (B139, 2026-08-16) and adapted to openqareer.
 *
 * Two deliberate differences from the previous openqareer behaviour:
 * the password floor drops from 12 to 8 — the owner called 12 "слишком
 * жестоко для клиентов" — and there is no login field at all, so the account
 * handle is derived from the address instead of being typed.
 *
 * These are pure functions with no React and no DOM: the same rules run in the
 * form and on the server, so the two can never disagree about what is valid.
 */

const MAX_NAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 254;
export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;

const NAME_ALLOWED = /^[a-zA-Zа-яА-ЯёЁ\s-]+$/u;
const EMAIL_SHAPE = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/u;
const HANDLE_ALLOWED = /^[a-z0-9][a-z0-9._-]*$/u;

/** Letters, spaces and hyphens only — applied while the candidate types. */
export function sanitizeName(input: string): string {
  return input.replace(/[^a-zA-Zа-яА-ЯёЁ\s-]/gu, '').slice(0, MAX_NAME_LENGTH);
}

/** Address characters only. Plus-aliases are removed, as in eterapy. */
export function sanitizeEmail(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9._@+-]/gu, '')
    .replace(/\+/gu, '')
    .slice(0, MAX_EMAIL_LENGTH);
}

export function getNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Введите имя';
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Имя слишком длинное (максимум ${MAX_NAME_LENGTH} символов)`;
  }
  if (!NAME_ALLOWED.test(trimmed)) {
    return 'Имя может содержать только буквы, пробелы и дефисы';
  }
  return null;
}

export function getEmailError(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return 'Введите email';
  if (trimmed.includes('+')) return 'Email не должен содержать символ «+»';
  if (trimmed.length > MAX_EMAIL_LENGTH) return 'Email слишком длинный';
  if (!EMAIL_SHAPE.test(trimmed)) return 'Введите корректный email';
  return null;
}

export function getPasswordError(password: string): string | null {
  if (!password) return 'Введите пароль';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return 'Пароль слишком длинный';
  if (new Set(password).size === 1) {
    return 'Пароль из одного повторяющегося символа слишком простой';
  }
  return null;
}

/**
 * Builds the stable account handle from the address. `isTaken` is supplied by
 * the caller so this stays pure and the server can check its own store.
 */
export function deriveUsernameFromEmail(
  email: string,
  isTaken: (candidate: string) => boolean,
): string {
  const localPart = email.trim().toLowerCase().split('@')[0] ?? '';
  const normalised = localPart.replace(/[^a-z0-9._-]/gu, '').replace(/^[^a-z0-9]+/u, '');
  // A three-character floor keeps derived handles compatible with the handles
  // candidates typed themselves before B139 removed the field.
  const base =
    normalised.length >= 3 && HANDLE_ALLOWED.test(normalised)
      ? normalised.slice(0, 72)
      : `${normalised}${randomSuffix()}`.slice(0, 72);

  if (!isTaken(base)) return base;
  for (let attempt = 2; attempt <= 99; attempt += 1) {
    const candidate = `${base}${attempt}`;
    if (!isTaken(candidate)) return candidate;
  }
  return `${base}${randomSuffix()}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
