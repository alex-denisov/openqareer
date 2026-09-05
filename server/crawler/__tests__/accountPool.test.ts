import { describe, expect, it } from 'vitest';
import { LinkedinAccountPool } from '../linkedinAccountPool';

describe('Linkedin account pool management', () => {
  it('initializes pool of 2-5 accounts with isolated profile directories', () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['account-1', 'account-2', 'account-3'],
      storageRoot: '/tmp/test-crawlers/linkedin',
    });

    const summary = pool.getPoolSummary();
    expect(summary.total).toBe(3);
    expect(summary.active).toBe(3);
    expect(summary.coolingDown).toBe(0);

    const acc = pool.getAvailableAccount();
    expect(acc).toBeDefined();
    expect(acc?.storagePath).toBe('/tmp/test-crawlers/linkedin/account-1');
  });

  it('rotates to next account and puts rate-limited account into cooldown', () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['account-1', 'account-2'],
      storageRoot: '/tmp/test-crawlers/linkedin',
      cooldownMinutes: 15,
    });

    const first = pool.getAvailableAccount();
    expect(first?.id).toBe('account-1');

    pool.recordRateLimit('account-1');

    const second = pool.getAvailableAccount();
    expect(second?.id).toBe('account-2');

    const summary = pool.getPoolSummary();
    expect(summary.active).toBe(1);
    expect(summary.coolingDown).toBe(1);
  });

  it('transitions account to checkpoint_required upon captcha or challenge without halting pool', () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['account-1', 'account-2'],
      storageRoot: '/tmp/test-crawlers/linkedin',
    });

    pool.recordChallenge('account-1', 'captcha_verification');

    const summary = pool.getPoolSummary();
    expect(summary.checkpointRequired).toBe(1);
    expect(summary.active).toBe(1);

    const available = pool.getAvailableAccount();
    expect(available?.id).toBe('account-2');
  });

  it('reports undefined when all accounts are unavailable and provides shortest wait time', () => {
    const pool = new LinkedinAccountPool({
      accountIds: ['account-1'],
      storageRoot: '/tmp/test-crawlers/linkedin',
      cooldownMinutes: 10,
    });

    pool.recordRateLimit('account-1');

    const available = pool.getAvailableAccount();
    expect(available).toBeUndefined();

    const waitMs = pool.getMinWaitTimeMs();
    expect(waitMs).toBeGreaterThan(0);
    expect(waitMs).toBeLessThanOrEqual(10 * 60 * 1000);
  });
});
