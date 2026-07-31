import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SealedText {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error('data encryption key must contain exactly 32 bytes');
    }
  }

  seal(plainText: string, associatedData: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    return [
      VERSION,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  open(sealed: string, associatedData: string): string {
    const [version, encodedIv, encodedTag, encodedCipher, ...rest] =
      sealed.split('.');
    if (
      version !== VERSION ||
      !encodedIv ||
      !encodedTag ||
      encodedCipher === undefined ||
      rest.length > 0
    ) {
      throw new Error('invalid sealed text envelope');
    }
    const iv = Buffer.from(encodedIv, 'base64url');
    const tag = Buffer.from(encodedTag, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('invalid sealed text envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCipher, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
