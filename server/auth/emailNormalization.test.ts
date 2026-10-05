import { describe, expect, it } from 'vitest';
import {
  canonicalizeEmail,
  isDisposableEmail,
  validateEmailAddress,
} from './emailNormalization';

describe('emailNormalization (B347 / US-11.5)', () => {
  describe('canonicalizeEmail', () => {
    it('trims whitespace and converts to lowercase', () => {
      expect(canonicalizeEmail('  Candidate@Example.COM  ')).toBe('candidate@example.com');
    });

    it('strips dots from Gmail / Googlemail usernames', () => {
      expect(canonicalizeEmail('j.o.h.n.d.o.e@gmail.com')).toBe('johndoe@gmail.com');
      expect(canonicalizeEmail('first.middle.last@googlemail.com')).toBe('firstmiddlelast@gmail.com');
    });

    it('normalizes Googlemail to gmail.com', () => {
      expect(canonicalizeEmail('user@googlemail.com')).toBe('user@gmail.com');
    });

    it('removes plus-tags / subaddressing for all providers', () => {
      expect(canonicalizeEmail('user+newsletter@gmail.com')).toBe('user@gmail.com');
      expect(canonicalizeEmail('candidate+test1@mail.ru')).toBe('candidate@mail.ru');
      expect(canonicalizeEmail('lead+openqareer@proton.me')).toBe('lead@proton.me');
      expect(canonicalizeEmail('employee+filter@corporate.co.uk')).toBe('employee@corporate.co.uk');
    });

    it('combines Gmail dot stripping and plus-tag removal', () => {
      expect(canonicalizeEmail('a.l.e.x+work@googlemail.com')).toBe('alex@gmail.com');
      expect(canonicalizeEmail('J.Doe+hiring@GMAIL.COM')).toBe('jdoe@gmail.com');
    });

    it('normalizes Yandex domain synonyms and unifies dots/dashes', () => {
      expect(canonicalizeEmail('user@ya.ru')).toBe('user@yandex.ru');
      expect(canonicalizeEmail('user@yandex.by')).toBe('user@yandex.ru');
      expect(canonicalizeEmail('ivan.petrov+test@ya.ru')).toBe('ivan.petrov@yandex.ru');
    });
  });

  describe('isDisposableEmail', () => {
    it('detects known disposable email services', () => {
      expect(isDisposableEmail('burner@tempmail.com')).toBe(true);
      expect(isDisposableEmail('fake@10minutemail.com')).toBe(true);
      expect(isDisposableEmail('anon@mailinator.com')).toBe(true);
      expect(isDisposableEmail('test@guerrillamail.com')).toBe(true);
      expect(isDisposableEmail('trash@sharklasers.com')).toBe(true);
      expect(isDisposableEmail('temp@dropmail.me')).toBe(true);
      expect(isDisposableEmail('throwaway@yopmail.com')).toBe(true);
    });

    it('permits legitimate email providers', () => {
      expect(isDisposableEmail('alex@gmail.com')).toBe(false);
      expect(isDisposableEmail('candidate@yandex.ru')).toBe(false);
      expect(isDisposableEmail('dev@mail.ru')).toBe(false);
      expect(isDisposableEmail('lead@proton.me')).toBe(false);
      expect(isDisposableEmail('founder@openqareer.com')).toBe(false);
      expect(isDisposableEmail('recruiter@company.org')).toBe(false);
    });
  });

  describe('validateEmailAddress', () => {
    it('accepts valid email addresses and returns canonical address', () => {
      const result = validateEmailAddress('Candidate.Fixture+test@gmail.com');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.canonicalEmail).toBe('candidatefixture@gmail.com');
      }
    });

    it('rejects invalid email formats', () => {
      expect(validateEmailAddress('').valid).toBe(false);
      expect(validateEmailAddress('not-an-email').valid).toBe(false);
      expect(validateEmailAddress('missing@domain').valid).toBe(false);
      expect(validateEmailAddress('@nodomain.com').valid).toBe(false);
      expect(validateEmailAddress('spaces in@domain.com').valid).toBe(false);
      expect(validateEmailAddress('.candidate@example.com').valid).toBe(false);
      expect(validateEmailAddress('candidate..name@example.com').valid).toBe(false);
    });

    it('rejects disposable email addresses with clear message', () => {
      const result = validateEmailAddress('spammer@tempmail.com');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('disposable');
        expect(result.message).toContain('Временные и одноразовые');
      }
    });
  });
});
