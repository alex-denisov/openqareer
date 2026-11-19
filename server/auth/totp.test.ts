import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, totpAt, matchTotp, otpauthUrl } from './totp';

// RFC 6238, приложение B: ключ «12345678901234567890», SHA-1; шесть младших цифр.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC test vectors', () => {
    expect(totpAt(RFC_SECRET, 59)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1111111109)).toBe('081804');
    expect(totpAt(RFC_SECRET, 1234567890)).toBe('005924');
    expect(totpAt(RFC_SECRET, 2000000000)).toBe('279037');
  });

  it('base32 round-trips and ignores spaces and case', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 128, 7]);
    const text = base32Encode(bytes);
    expect(base32Decode(text.toLowerCase().replace(/(.{4})/gu, '$1 '))).toEqual(bytes);
  });

  it('accepts the current and adjacent steps, returns the step used', () => {
    const now = 1_700_000_000;
    const code = totpAt(RFC_SECRET, now - 30);
    expect(matchTotp(RFC_SECRET, code, now)).toBe(Math.floor((now - 30) / 30));
    expect(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 90), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
    expect(matchTotp(RFC_SECRET, ` ${totpAt(RFC_SECRET, now)} `, now)).toBe(Math.floor(now / 30));
  });

  it('a new secret is 20 random bytes; the setup link names the issuer', () => {
    const secret = generateTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(secret).not.toBe(generateTotpSecret());
    const url = new URL(otpauthUrl(secret, 'anna@example.test'));
    expect(url.protocol).toBe('otpauth:');
    expect(url.searchParams.get('secret')).toBe(secret);
    expect(url.searchParams.get('issuer')).toBe('openqareer');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/openqareer:anna@example.test');
  });
});
