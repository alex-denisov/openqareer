import { isLinkedinSessionCookieDomain, type LinkedinSessionCookie } from './sessionContract';

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u;
const MAX_COOKIE_COUNT = 100;
const MAX_COOKIE_VALUE_LENGTH = 8_192;
const MAX_COOKIE_PATH_LENGTH = 1_024;
const MAX_ENCRYPTED_PAYLOAD_BYTES = 48 * 1_024;

export type LinkedinSessionCookiePreparation =
  | {
      readonly ok: true;
      readonly cookies: readonly LinkedinSessionCookie[];
      readonly expiresAt: string;
    }
  | { readonly ok: false; readonly code: string };

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}

function isValidLinkedinCookie(cookie: LinkedinSessionCookie): boolean {
  return (
    COOKIE_NAME.test(cookie.name) &&
    cookie.name.length <= 256 &&
    Boolean(cookie.value) &&
    cookie.value.length <= MAX_COOKIE_VALUE_LENGTH &&
    !hasControlCharacter(cookie.value) &&
    !cookie.value.includes(';') &&
    isLinkedinSessionCookieDomain(cookie.domain) &&
    cookie.path.startsWith('/') &&
    cookie.path.length <= MAX_COOKIE_PATH_LENGTH &&
    !hasControlCharacter(cookie.path) &&
    typeof cookie.httpOnly === 'boolean' &&
    typeof cookie.secure === 'boolean' &&
    (cookie.sameSite === null || ['Strict', 'Lax', 'None'].includes(cookie.sameSite)) &&
    (cookie.expiresAt === null || Number.isSafeInteger(cookie.expiresAt)) &&
    (cookie.sameSite !== 'None' || cookie.secure)
  );
}

function expiryForLiAtCookies(
  cookies: readonly LinkedinSessionCookie[],
  now: Date,
): { readonly expiresAt?: string; readonly error?: string } {
  const liAtCookies = cookies.filter((cookie) => cookie.name === 'li_at');
  if (
    liAtCookies.length === 0 ||
    liAtCookies.some((cookie) => !cookie.value || !cookie.httpOnly || !cookie.secure)
  ) {
    return { error: 'linkedin_session_cookie_required' };
  }
  const values = new Set(liAtCookies.map((cookie) => cookie.value));
  const expiries = liAtCookies
    .map((cookie) => cookie.expiresAt)
    .filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value));
  if (values.size !== 1 || expiries.length !== liAtCookies.length) {
    return { error: 'linkedin_session_expiry_required' };
  }
  const expiresAtDate = new Date(Math.min(...expiries) * 1_000);
  if (expiresAtDate.getTime() <= now.getTime()) {
    return { error: 'linkedin_session_expired' };
  }
  return { expiresAt: expiresAtDate.toISOString() };
}

export function prepareLinkedinSessionCookies(
  cookies: readonly LinkedinSessionCookie[],
  now: Date,
): LinkedinSessionCookiePreparation {
  if (cookies.length < 1 || cookies.length > MAX_COOKIE_COUNT) {
    return { ok: false, code: 'linkedin_session_cookie_count_invalid' };
  }
  if (!cookies.every(isValidLinkedinCookie)) {
    return { ok: false, code: 'linkedin_session_cookie_invalid' };
  }
  const expiry = expiryForLiAtCookies(cookies, now);
  if (!expiry.expiresAt) return { ok: false, code: expiry.error ?? 'linkedin_session_expired' };

  const normalized = cookies.map((cookie) => ({
    ...cookie,
    domain: cookie.domain.trim().toLowerCase().replace(/^\./u, ''),
  }));
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    return { ok: false, code: 'linkedin_session_payload_too_large' };
  }
  return { ok: true, cookies: normalized, expiresAt: expiry.expiresAt };
}
