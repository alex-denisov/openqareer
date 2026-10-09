import { beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  RegistrationVelocityLimiter,
  normalizeIpSubnet,
  parseClientFingerprint,
  toRegistrationFingerprintLog,
} from './registrationAntiAbuse';
import { deriveKey } from './derivedHmacKey';

describe('registrationAntiAbuse (B347 / US-11.5)', () => {
  describe('normalizeIpSubnet', () => {
    it('normalizes IPv4 to /24 subnet', () => {
      expect(normalizeIpSubnet('192.168.1.42')).toBe('192.168.1.0/24');
      expect(normalizeIpSubnet('95.173.136.254')).toBe('95.173.136.0/24');
      expect(normalizeIpSubnet('127.0.0.1')).toBe('127.0.0.0/24');
      expect(normalizeIpSubnet('::ffff:192.168.1.42')).toBe('192.168.1.0/24');
    });

    it('normalizes IPv6 to /48 subnet', () => {
      expect(normalizeIpSubnet('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(
        '2001:db8:85a3::/48',
      );
      expect(normalizeIpSubnet('::1')).toBe('::1');
    });

    it('handles invalid or unknown IPs gracefully', () => {
      expect(normalizeIpSubnet('')).toBe('unknown');
      expect(normalizeIpSubnet('invalid-ip')).toBe('unknown');
      expect(normalizeIpSubnet('192.168.1.999')).toBe('unknown');
      expect(normalizeIpSubnet('2001:db8:zzzz::1')).toBe('unknown');
    });
  });

  describe('parseClientFingerprint', () => {
    it('extracts headers, subnet and computes fingerprint hash', () => {
      const headers = {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
        'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24"',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-mobile': '?0',
      };
      const fp = parseClientFingerprint(headers, '178.62.204.15');

      expect(fp.ip).toBe('178.62.204.15');
      expect(fp.subnet).toBe('178.62.204.0/24');
      expect(fp.userAgent).toContain('Mozilla/5.0');
      expect(fp.acceptLanguage).toBe('ru-RU,ru;q=0.9,en;q=0.8');
      expect(fp.secChUaPlatform).toBe('"macOS"');
      expect(fp.secChUaMobile).toBe('?0');
      expect(fp.fingerprintHash).toBeDefined();
      expect(fp.fingerprintHash.length).toBe(64); // SHA-256

      const logFields = toRegistrationFingerprintLog(fp, Buffer.alloc(32, 7));
      expect(logFields.subnetHash).toHaveLength(64);
      expect(logFields.userAgentHash).toHaveLength(64);
      expect(logFields.acceptLanguageHash).toHaveLength(64);
      expect(logFields.clientHintsHash).toHaveLength(64);
      expect(JSON.stringify(logFields)).not.toContain('178.62.204.15');
      expect(JSON.stringify(logFields)).not.toContain('Mozilla/5.0');
      expect(JSON.stringify(logFields)).not.toContain('macOS');
    });

    it('hashes anti-abuse fingerprint data with a purpose-derived key', () => {
      const secret = Buffer.alloc(32, 5);
      const fingerprint = parseClientFingerprint({}, '192.0.2.40');
      const expected = createHmac('sha256', deriveKey(secret, 'registration-fingerprint'))
        .update(fingerprint.subnet)
        .digest('hex');

      expect(toRegistrationFingerprintLog(fingerprint, secret).subnetHash).toBe(expected);
      expect(toRegistrationFingerprintLog(fingerprint, secret).subnetHash).not.toBe(
        createHmac('sha256', secret).update(fingerprint.subnet).digest('hex'),
      );
    });
  });

  describe('RegistrationVelocityLimiter', () => {
    let limiter: RegistrationVelocityLimiter;

    beforeEach(() => {
      limiter = new RegistrationVelocityLimiter({
        maxRegistrationsPerSubnet: 3,
        windowMs: 3600 * 1000,
      });
    });

    it('allows up to maxRegistrationsPerSubnet within the window', () => {
      const subnet = '192.168.1.0/24';
      const now = 1000000;

      const r1 = limiter.checkAndRecord(subnet, now);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = limiter.checkAndRecord(subnet, now + 1000);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = limiter.checkAndRecord(subnet, now + 2000);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);

      // 4th registration from the same /24 subnet is blocked!
      const r4 = limiter.checkAndRecord(subnet, now + 3000);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('does not block registrations from a different subnet', () => {
      const now = 1000000;
      limiter.checkAndRecord('10.0.1.0/24', now);
      limiter.checkAndRecord('10.0.1.0/24', now);
      limiter.checkAndRecord('10.0.1.0/24', now);
      expect(limiter.checkAndRecord('10.0.1.0/24', now).allowed).toBe(false);

      // Different subnet is allowed
      const rOther = limiter.checkAndRecord('10.0.2.0/24', now);
      expect(rOther.allowed).toBe(true);
    });

    it('resets quota after window expires', () => {
      const subnet = '172.16.0.0/24';
      const t0 = 1000000;
      limiter.checkAndRecord(subnet, t0);
      limiter.checkAndRecord(subnet, t0 + 10);
      limiter.checkAndRecord(subnet, t0 + 20);
      expect(limiter.checkAndRecord(subnet, t0 + 30).allowed).toBe(false);

      // Advance time by 3601 seconds
      const tAfter = t0 + 3601 * 1000;
      const rAfter = limiter.checkAndRecord(subnet, tAfter);
      expect(rAfter.allowed).toBe(true);
      expect(rAfter.remaining).toBe(2);
    });

    it('bounds retained subnet state under high-cardinality traffic', () => {
      let lastResult: ReturnType<RegistrationVelocityLimiter['checkAndRecord']> | undefined;
      for (let index = 0; index < 10_001; index += 1) {
        lastResult = limiter.checkAndRecord(
          `198.51.${Math.floor(index / 256)}.${index % 256}/24`,
          index,
        );
      }
      expect(lastResult?.allowed).toBe(false);
      expect(limiter.trackedSubnets).toBeLessThanOrEqual(10_000);
    });
  });
});
