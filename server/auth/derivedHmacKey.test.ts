import { describe, expect, it } from 'vitest';
import { deriveKey } from './derivedHmacKey';

describe('B433 purpose-specific HMAC keys', () => {
  it('returns a stable key for one secret and purpose', () => {
    const secret = Buffer.alloc(32, 7);

    expect(deriveKey(secret, 'email-verification-code')).toEqual(
      deriveKey(secret, 'email-verification-code'),
    );
  });

  it('separates keys across purposes', () => {
    const secret = Buffer.alloc(32, 7);

    expect(deriveKey(secret, 'email-verification-code')).not.toEqual(
      deriveKey(secret, 'registration-fingerprint'),
    );
  });
});
