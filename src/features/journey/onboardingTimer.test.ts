import { describe, expect, it } from 'vitest';
import { formatOnboardingDuration, startOnboardingTimer } from './onboardingTimer';

describe('onboardingTimer', () => {
  it('captures the moment the wizard started', () => {
    const timer = startOnboardingTimer(1_000);
    expect(timer.startedAt).toBe(1_000);
  });

  it('formats seconds only, under a minute', () => {
    const timer = startOnboardingTimer(0);
    expect(formatOnboardingDuration(timer, 7_000)).toBe('7 секунд');
    expect(formatOnboardingDuration(timer, 1_000)).toBe('1 секунда');
    expect(formatOnboardingDuration(timer, 3_000)).toBe('3 секунды');
  });

  it('formats minutes and seconds together, matching the mockup wording', () => {
    const timer = startOnboardingTimer(0);
    // 4 минуты 40 секунд — the exact sentence from onboarding.html step 6.
    expect(formatOnboardingDuration(timer, 280_000)).toBe('4 минуты 40 секунд');
    expect(formatOnboardingDuration(timer, 60_000)).toBe('1 минута 0 секунд');
    expect(formatOnboardingDuration(timer, 660_000)).toBe('11 минут 0 секунд');
  });

  it('never reports a negative duration for clock skew', () => {
    const timer = startOnboardingTimer(10_000);
    expect(formatOnboardingDuration(timer, 4_000)).toBe('0 секунд');
  });
});
