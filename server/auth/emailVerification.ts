import { createHash, createHmac, randomInt } from 'node:crypto';

export { EMAIL_VERIFICATION_CUTOVER_AT } from '../data/emailVerificationSchema';
export const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1_000;
export const EMAIL_VERIFICATION_RESEND_MS = 60 * 1_000;
export const EMAIL_VERIFICATION_RATE_LIMIT_MS = 60 * 60 * 1_000;
export const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5;
export const EMAIL_VERIFICATION_MAX_SENDS_PER_HOUR = 5;

export interface EmailVerificationDelivery {
  readonly candidateId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly code: string;
  readonly expiresAt: string;
}

export function newEmailVerificationCode(fixedCode?: string): string {
  return fixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function emailVerificationCodeHash(
  candidateId: string,
  code: string,
  secret: Buffer,
): string {
  return createHmac('sha256', secret)
    .update(`openqareer-email-verification-v1\u0000${candidateId}\u0000${code}`)
    .digest('hex');
}

export function isVerificationTestAddress(
  email: string,
  bypassDomains: readonly string[],
): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase().replace(/\.+$/u, '');
  return bypassDomains.some((value) => {
    const bypass = value.trim().toLowerCase().replace(/\.+$/u, '');
    return bypass.length > 0 && (domain === bypass || domain.endsWith(`.${bypass}`));
  });
}

export class EmailVerificationRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  checkAndRecord(email: string, clientIp: string, now: number, accountId?: string): number | null {
    const buckets = rateLimitBuckets(this.buckets, email, clientIp, accountId, now);
    const retryAfter = Math.max(0, ...buckets.map(({ timestamps }) =>
      timestamps.length >= EMAIL_VERIFICATION_MAX_SENDS_PER_HOUR
        ? Math.max(1, Math.ceil((timestamps[0]! + EMAIL_VERIFICATION_RATE_LIMIT_MS - now) / 1_000))
        : 0,
    ));
    if (retryAfter > 0) return retryAfter;
    for (const { key, timestamps } of buckets) {
      timestamps.push(now);
      if (!this.buckets.has(key) && this.buckets.size >= 5_000) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      this.buckets.set(key, timestamps);
    }
    return null;
  }
}

function rateLimitBuckets(
  source: Map<string, number[]>,
  email: string,
  clientIp: string,
  accountId: string | undefined,
  now: number,
): Array<{ key: string; timestamps: number[] }> {
  const normalizedEmail = email.trim().toLowerCase();
  const dimensions = [
    ['email', normalizedEmail],
    ['ip', clientIp.trim()],
    ['pair', normalizedEmail + '\u0000' + clientIp.trim()],
    ...(accountId ? [['account', accountId] as [string, string]] : []),
  ];
  const cutoff = now - EMAIL_VERIFICATION_RATE_LIMIT_MS;
  return dimensions.map(([scope, value]) => {
    const key = scope + ':' + createHash('sha256').update(value).digest('hex');
    const timestamps = (source.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    return { key, timestamps };
  });
}
