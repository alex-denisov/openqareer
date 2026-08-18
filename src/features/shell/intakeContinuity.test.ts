import { describe, expect, it } from 'vitest';
import {
  keepsIntakeAcrossIdentityChange,
  shouldShowIntake,
  type IntakeVisibilityInput,
} from './intakeContinuity';

const anonymousStart: IntakeVisibilityInput = {
  sessionPending: false,
  hasWorkspace: false,
  hasCabinetSession: false,
  intakeStarted: false,
  isTodayView: true,
};

describe('shouldShowIntake', () => {
  it('opens the diagnostic for a visitor without an account', () => {
    expect(shouldShowIntake(anonymousStart)).toBe(true);
  });

  it('keeps a started diagnostic on screen when the account it demanded arrives', () => {
    expect(
      shouldShowIntake({
        ...anonymousStart,
        hasCabinetSession: true,
        intakeStarted: true,
      }),
    ).toBe(true);
  });

  it('opens the diagnostic for a newly registered candidate without a workspace', () => {
    expect(
      shouldShowIntake({ ...anonymousStart, hasCabinetSession: true }),
    ).toBe(true);
  });

  it('hands the screen over once the career picture exists', () => {
    expect(
      shouldShowIntake({
        ...anonymousStart,
        hasWorkspace: true,
        intakeStarted: true,
      }),
    ).toBe(false);
  });

  it('shows nothing while identity is still being checked', () => {
    expect(
      shouldShowIntake({ ...anonymousStart, sessionPending: true }),
    ).toBe(false);
  });

  it('never takes over another screen', () => {
    expect(
      shouldShowIntake({ ...anonymousStart, isTodayView: false }),
    ).toBe(false);
  });
});

describe('keepsIntakeAcrossIdentityChange', () => {
  it('keeps the answers when an anonymous visitor registers mid-wizard', () => {
    expect(keepsIntakeAcrossIdentityChange(null, 'candidate-1')).toBe(true);
    expect(keepsIntakeAcrossIdentityChange(undefined, 'candidate-1')).toBe(true);
  });

  it('resets on sign-out so nothing typed survives without an owner', () => {
    expect(keepsIntakeAcrossIdentityChange('candidate-1', null)).toBe(false);
  });

  it('resets when a different candidate takes over the browser', () => {
    expect(keepsIntakeAcrossIdentityChange('candidate-1', 'candidate-2')).toBe(false);
  });

  it('resets when an account without a candidate id signs in', () => {
    expect(keepsIntakeAcrossIdentityChange(null, null)).toBe(false);
  });
});
