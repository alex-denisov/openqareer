import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export interface ClientFingerprint {
  ip: string;
  subnet: string;
  userAgent: string;
  acceptLanguage: string;
  secChUa?: string;
  secChUaPlatform?: string;
  secChUaMobile?: string;
  fingerprintHash: string;
}

export interface RegistrationFingerprintLog {
  subnetHash: string;
  userAgentHash: string;
  acceptLanguageHash: string;
  clientHintsHash: string;
  fingerprintHash: string;
}

export interface VelocityLimiterOptions {
  maxRegistrationsPerSubnet?: number;
  windowMs?: number;
}

export interface VelocityCheckResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

/**
 * Normalizes an IPv4 or IPv6 address to its provider network subnet (/24 for IPv4, /48 for IPv6).
 */
export function normalizeIpSubnet(ip: string): string {
  const input = ip.trim();
  const mappedIpv4 = input.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  const trimmed = mappedIpv4 ?? input;
  if (isIP(trimmed) === 0) return 'unknown';
  if (!trimmed) return 'unknown';

  if (trimmed === '::1' || trimmed === '127.0.0.1') {
    return trimmed === '::1' ? '::1' : '127.0.0.0/24';
  }

  // IPv4 check: e.g. 192.168.1.42 -> 192.168.1.0/24
  const ipv4Parts = trimmed.split('.');
  if (ipv4Parts.length === 4) {
    const validOctets = ipv4Parts.every((part) => {
      const num = Number(part);
      return !Number.isNaN(num) && num >= 0 && num <= 255;
    });
    if (validOctets) {
      return `${ipv4Parts[0]}.${ipv4Parts[1]}.${ipv4Parts[2]}.0/24`;
    }
  }

  // IPv6 check: e.g. 2001:0db8:85a3:... -> 2001:db8:85a3::/48
  if (trimmed.includes(':')) {
    const parts = trimmed.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const segments = parts.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
      : left;
    if (segments.length === 8) {
      const firstThree = segments.slice(0, 3).map((segment) => parseInt(segment, 16));
      if (firstThree.every((segment) => Number.isInteger(segment))) {
        return `${firstThree.map((segment) => segment.toString(16)).join(':')}::/48`;
      }
    }
  }

  return 'unknown';
}

/**
 * Extracts and hashes client environment signals for registration security logging (ETerapy pattern).
 */
export function parseClientFingerprint(
  headers: Record<string, string | string[] | undefined>,
  ip: string,
): ClientFingerprint {
  const userAgent = (Array.isArray(headers['user-agent'])
    ? headers['user-agent'][0]
    : headers['user-agent']) || 'unknown';

  const acceptLanguage = (Array.isArray(headers['accept-language'])
    ? headers['accept-language'][0]
    : headers['accept-language']) || 'unknown';

  const secChUa = Array.isArray(headers['sec-ch-ua'])
    ? headers['sec-ch-ua'][0]
    : headers['sec-ch-ua'];
  const secChUaPlatform = Array.isArray(headers['sec-ch-ua-platform'])
    ? headers['sec-ch-ua-platform'][0]
    : headers['sec-ch-ua-platform'];
  const secChUaMobile = Array.isArray(headers['sec-ch-ua-mobile'])
    ? headers['sec-ch-ua-mobile'][0]
    : headers['sec-ch-ua-mobile'];

  const subnet = normalizeIpSubnet(ip);

  const hashInput = `${ip}|${userAgent}|${acceptLanguage}|${secChUa || ''}|${secChUaPlatform || ''}|${secChUaMobile || ''}`;
  const fingerprintHash = createHash('sha256').update(hashInput).digest('hex');

  return {
    ip,
    subnet,
    userAgent,
    acceptLanguage,
    secChUa,
    secChUaPlatform,
    secChUaMobile,
    fingerprintHash,
  };
}

/** Возвращает корреляционные хеши без записи IP и исходных заголовков в журнал. */
export function toRegistrationFingerprintLog(
  fingerprint: ClientFingerprint,
  key: Buffer,
): RegistrationFingerprintLog {
  const hash = (value: string) => createHmac('sha256', key).update(value).digest('hex');
  const clientHints = [
    fingerprint.secChUa,
    fingerprint.secChUaPlatform,
    fingerprint.secChUaMobile,
  ].join('|');
  return {
    subnetHash: hash(fingerprint.subnet),
    userAgentHash: hash(fingerprint.userAgent),
    acceptLanguageHash: hash(fingerprint.acceptLanguage),
    clientHintsHash: hash(clientHints),
    fingerprintHash: hash(fingerprint.fingerprintHash),
  };
}

/**
 * Sliding window registration velocity limiter per subnet to protect against mass registration botnets.
 */
export class RegistrationVelocityLimiter {
  private static readonly MAX_TRACKED_SUBNETS = 10_000;
  private readonly maxRegistrations: number;
  private readonly windowMs: number;
  private readonly records = new Map<string, number[]>();
  private checksSinceCleanup = 0;

  constructor(options: VelocityLimiterOptions = {}) {
    this.maxRegistrations = options.maxRegistrationsPerSubnet ?? 3;
    this.windowMs = options.windowMs ?? 3600 * 1000;
  }

  checkAndRecord(subnet: string, now: number = Date.now()): VelocityCheckResult {
    this.cleanupExpired(now);
    const existing = this.records.get(subnet) || [];
    const validTimestamps = existing.filter((t) => now - t < this.windowMs);
    if (validTimestamps.length === 0) this.records.delete(subnet);

    if (validTimestamps.length >= this.maxRegistrations) {
      const oldest = validTimestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    validTimestamps.push(now);
    if (
      !this.records.has(subnet) &&
      this.records.size >= RegistrationVelocityLimiter.MAX_TRACKED_SUBNETS
    ) {
      const oldestRecord = Math.min(...Array.from(this.records.values(), (timestamps) => timestamps[0]));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldestRecord + this.windowMs - now) / 1000)),
      };
    }
    this.records.set(subnet, validTimestamps);

    return {
      allowed: true,
      remaining: this.maxRegistrations - validTimestamps.length,
    };
  }

  get trackedSubnets(): number {
    return this.records.size;
  }

  reset(): void {
    this.records.clear();
  }

  private cleanupExpired(now: number): void {
    this.checksSinceCleanup += 1;
    if (this.checksSinceCleanup < 256) return;
    this.checksSinceCleanup = 0;
    for (const [subnet, timestamps] of this.records) {
      const valid = timestamps.filter((timestamp) => now - timestamp < this.windowMs);
      if (valid.length === 0) this.records.delete(subnet);
      else this.records.set(subnet, valid);
    }
  }
}

export const defaultRegistrationLimiter = new RegistrationVelocityLimiter();
