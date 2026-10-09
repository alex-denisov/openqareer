import { describe, expect, it } from 'vitest';
import { PasswordResetRequestRateLimiter } from './passwordResetRequestLimiter';

describe('password reset request rate limiting', () => {
  it('limits repeated requests for one address across different IPs', () => {
    const limiter = new PasswordResetRequestRateLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.checkAndRecord(' Candidate@Example.com ', `192.0.2.${attempt}`, 100)).toBeNull();
    }

    expect(limiter.checkAndRecord('candidate@example.com', '198.51.100.1', 101)).toBe(3_600);
  });

  it('limits repeated requests from one IP across different addresses', () => {
    const limiter = new PasswordResetRequestRateLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.checkAndRecord(`candidate-${attempt}@example.com`, '192.0.2.10', 100)).toBeNull();
    }

    expect(limiter.checkAndRecord('candidate-six@example.com', '192.0.2.10', 101)).toBe(3_600);
  });
});
