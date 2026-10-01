import { describe, expect, it } from 'vitest';
import { classifyLinkedinLanding } from './linkedin-pool-session-probe';

describe('classifyLinkedinLanding', () => {
  it('reads the signed-in feed by its title when the nav markup changed', () => {
    expect(
      classifyLinkedinLanding('https://www.linkedin.com/feed/', false, 'Feed | LinkedIn'),
    ).toBe('signed_in');
  });
  it('names the login form, the authwall and a checkpoint apart', () => {
    expect(classifyLinkedinLanding('https://www.linkedin.com/login?x=1', false)).toBe(
      'login_required',
    );
    expect(classifyLinkedinLanding('https://www.linkedin.com/authwall', false)).toBe(
      'login_required',
    );
    expect(classifyLinkedinLanding('https://www.linkedin.com/checkpoint/challenge/x', false)).toBe(
      'checkpoint',
    );
  });
});
