import { createHash, hkdfSync } from 'node:crypto';

export type HmacKeyPurpose =
  | 'email-verification-code'
  | 'registration-fingerprint'
  | 'email-delivery-recipient';

const DERIVATION_SALT = Buffer.from('openqareer-hmac-key-derivation-v1');
const derivedKeys = new Map<string, Buffer>();

export function deriveKey(secret: Buffer, purpose: HmacKeyPurpose): Buffer {
  const secretDigest = createHash('sha256').update(secret).digest('hex');
  const cacheKey = `${secretDigest}\u0000${purpose}`;
  const cached = derivedKeys.get(cacheKey);
  if (cached) return Buffer.from(cached);

  const key = Buffer.from(
    hkdfSync('sha256', secret, DERIVATION_SALT, Buffer.from(`openqareer:${purpose}:v1`), 32),
  );
  derivedKeys.set(cacheKey, key);
  return Buffer.from(key);
}
