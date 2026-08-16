import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  deriveUsernameFromEmail,
  getEmailError,
  getNameError,
  getPasswordError,
  sanitizeEmail,
  sanitizeName,
} from './accountValidation';

describe('sanitizeName', () => {
  it('keeps Cyrillic and Latin letters, spaces and hyphens', () => {
    expect(sanitizeName('Алексей Денисов')).toBe('Алексей Денисов');
    expect(sanitizeName('Anna-Maria')).toBe('Anna-Maria');
  });

  it('strips digits and punctuation as the candidate types', () => {
    expect(sanitizeName('Алексей123!')).toBe('Алексей');
  });

  it('caps the length instead of silently accepting anything', () => {
    expect(sanitizeName('я'.repeat(80))).toHaveLength(50);
  });
});

describe('getNameError', () => {
  it('names the field when it is empty', () => {
    expect(getNameError('')).toBe('Введите имя');
    expect(getNameError('   ')).toBe('Введите имя');
  });

  it('accepts an ordinary Russian first name', () => {
    expect(getNameError('Алексей')).toBeNull();
  });

  it('explains what characters are allowed', () => {
    expect(getNameError('A1')).toContain('буквы');
  });
});

describe('sanitizeEmail / getEmailError', () => {
  it('accepts a normal address', () => {
    expect(getEmailError('alexey@example.com')).toBeNull();
  });

  it('names the field when it is empty', () => {
    expect(getEmailError('')).toBe('Введите email');
  });

  it('rejects an address without a domain zone', () => {
    expect(getEmailError('alexey@example')).toBe('Введите корректный email');
  });

  it('rejects plus-aliases, matching the eterapy rule the owner asked for', () => {
    expect(getEmailError('alexey+job@example.com')).toContain('+');
    expect(sanitizeEmail('alexey+job@example.com')).toBe('alexeyjob@example.com');
  });

  it('drops characters an address cannot contain', () => {
    expect(sanitizeEmail('алексей a@example.com')).toBe('a@example.com');
  });
});

describe('getPasswordError', () => {
  it('lets an eight-character password through', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(getPasswordError('parol123')).toBeNull();
  });

  it('rejects anything shorter and says the actual minimum', () => {
    expect(getPasswordError('parol12')).toContain('8');
  });

  it('names the field when it is empty', () => {
    expect(getPasswordError('')).toBe('Введите пароль');
  });

  it('rejects a single repeated character', () => {
    expect(getPasswordError('aaaaaaaa')).not.toBeNull();
  });
});

describe('deriveUsernameFromEmail', () => {
  // The owner asked why a login field exists at all. It does not any more —
  // the account still needs a stable handle, so we derive one.
  it('uses the local part of the address', () => {
    expect(deriveUsernameFromEmail('alexey@example.com', () => false)).toBe('alexey');
  });

  it('normalises characters the handle cannot hold', () => {
    expect(deriveUsernameFromEmail('Alexey.D-1@example.com', () => false)).toBe('alexey.d-1');
  });

  it('falls back when the local part is too short to be a handle', () => {
    expect(deriveUsernameFromEmail('ab@example.com', () => false)).toMatch(/^ab[0-9a-z]+$/u);
  });

  it('resolves a collision instead of failing registration', () => {
    const taken = new Set(['alexey', 'alexey2']);
    expect(deriveUsernameFromEmail('alexey@example.com', (name) => taken.has(name))).toBe(
      'alexey3',
    );
  });
});
