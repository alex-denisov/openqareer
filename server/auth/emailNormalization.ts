/**
 * Email normalization, canonicalization and anti-abuse verification.
 * Ported and enhanced from ETerapy anti-abuse patterns (B347 / US-11.5).
 */

const EMAIL_SYNTAX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const DOMAIN_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
  'googlemail.com': 'gmail.com',
  'ya.ru': 'yandex.ru',
  'yandex.by': 'yandex.ru',
});

/**
 * Curated list of known temporary/disposable mailbox domains.
 */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  '10minutemail.com',
  '10minutemail.net',
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'sharklasers.com',
  'grr.la',
  'guerrillamailblock.com',
  'dropmail.me',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'trashmail.com',
  'trashmail.net',
  'trashmail.me',
  'dispostable.com',
  'maildrop.cc',
  'getairmail.com',
  'mohmal.com',
  'crazymailing.com',
  'fakemailgenerator.com',
  'mytemp.email',
  'throwawaymail.com',
  'generator.email',
]);

/**
 * Canonicalizes an email address into its unique root identity:
 * - Strips leading/trailing whitespace and converts to lowercase
 * - Strips plus-addressing (+tag) across all providers
 * - Resolves known domain aliases (e.g. googlemail.com -> gmail.com, ya.ru -> yandex.ru)
 * - Removes dots for Gmail/Googlemail accounts
 * - Applies known Yandex domain aliases
 */
export function canonicalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0) return trimmed;

  let localPart = trimmed.slice(0, atIndex);
  let domain = trimmed.slice(atIndex + 1);

  // 1. Domain synonym resolution
  if (DOMAIN_SYNONYMS[domain]) {
    domain = DOMAIN_SYNONYMS[domain];
  }

  // 2. Strip plus subaddressing (+tag)
  const plusIndex = localPart.indexOf('+');
  if (plusIndex !== -1) {
    localPart = localPart.slice(0, plusIndex);
  }

  // 3. Provider-specific local-part canonicalization
  if (domain === 'gmail.com') {
    localPart = localPart.replace(/\./g, '');
  }

  return `${localPart}@${domain}`;
}

/**
 * Checks if an email or domain belongs to a known disposable email provider.
 */
export function isDisposableEmail(emailOrDomain: string): boolean {
  const trimmed = emailOrDomain.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  const domain = atIndex !== -1 ? trimmed.slice(atIndex + 1) : trimmed;
  return DISPOSABLE_DOMAINS.has(domain);
}

export type EmailValidationResult =
  | { valid: true; canonicalEmail: string }
  | {
      valid: false;
      reason: 'empty' | 'syntax' | 'disposable';
      message: string;
    };

/**
 * Validates email format and screens against disposable domains.
 */
export function validateEmailAddress(email: string): EmailValidationResult {
  const trimmed = email.trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: 'empty',
      message: 'Введите email адрес.',
    };
  }

  const [localPart = ''] = trimmed.split('@');
  if (
    trimmed.length > 254 ||
    !EMAIL_SYNTAX.test(trimmed) ||
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..')
  ) {
    return {
      valid: false,
      reason: 'syntax',
      message: 'Некорректный формат email адреса.',
    };
  }

  if (isDisposableEmail(trimmed)) {
    return {
      valid: false,
      reason: 'disposable',
      message:
        'Временные и одноразовые почтовые ящики не поддерживаются. Пожалуйста, укажите постоянный рабочий или личный email.',
    };
  }

  return {
    valid: true,
    canonicalEmail: canonicalizeEmail(trimmed),
  };
}
