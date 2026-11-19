import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** B401: одноразовые коды по времени (RFC 6238): SHA-1, 6 цифр, шаг 30 секунд. */
const STEP_SECONDS = 30;
const DIGITS = 6;
/** Соседний шаг в обе стороны: часы телефона и сервера расходятся. */
const DRIFT_STEPS = 1;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const ISSUER = 'openqareer';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/gu, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(key: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpAt(secret: string, unixSeconds: number): string {
  return hotp(base32Decode(secret), Math.floor(unixSeconds / STEP_SECONDS));
}

/** Номер шага, которому соответствует код, или `null`. Повтор шага отсекает вызывающий. */
export function matchTotp(secret: string, input: string, unixSeconds: number): number | null {
  const code = input.trim();
  if (!/^\d{6}$/u.test(code)) return null;
  const key = base32Decode(secret);
  const current = Math.floor(unixSeconds / STEP_SECONDS);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** Ссылка для QR-кода приложения-аутентификатора. */
export function otpauthUrl(secret: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  const params = new URLSearchParams({ secret, issuer: ISSUER, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
