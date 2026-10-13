import { describe, expect, it } from 'vitest';
import {
  isSectionNavigable,
  sectionLockReason,
  type ShellNavigationState,
} from './shellNavigation';

const firstTime: ShellNavigationState = {
  careerPictureReady: false,
  resumeAvailable: false,
  candidateSessionAvailable: false,
  careerDiaryAvailable: false,
  canUseWorkspaceViews: false,
};

const finished: ShellNavigationState = {
  careerPictureReady: true,
  resumeAvailable: true,
  candidateSessionAvailable: true,
  careerDiaryAvailable: true,
  canUseWorkspaceViews: true,
};

describe('shell navigation', () => {
  it('keeps «Сегодня» reachable at all times, because the wizard lives there', () => {
    expect(isSectionNavigable('today', firstTime)).toBe(true);
    expect(isSectionNavigable('today', finished)).toBe(true);
  });

  it('makes notifications available to an account even before the career picture is complete', () => {
    const notifications = 'notifications';
    expect(isSectionNavigable(notifications, firstTime)).toBe(false);
    expect(isSectionNavigable(notifications, { ...firstTime, resumeAvailable: true })).toBe(true);
    expect(sectionLockReason(notifications, firstTime)).toContain('аккаунт');
  });

  /**
   * B169 §5 — «Тарифы» was the one section a candidate could reach mid-wizard.
   * Pricing before the product has said anything about their career asks them
   * to buy a result they have not been shown, and it is a door out of an
   * unfinished diagnostic.
   */
  it('closes «Тарифы» until the diagnostic has produced a career picture', () => {
    expect(isSectionNavigable('tariffs', firstTime)).toBe(false);
    expect(isSectionNavigable('tariffs', finished)).toBe(true);
  });

  it('closes every other section until the career picture exists', () => {
    for (const section of ['profile', 'career', 'opportunities', 'resume'] as const) {
      expect(isSectionNavigable(section, firstTime), section).toBe(false);
    }
  });

  it('keeps «Резюме» closed without an account even once the picture exists', () => {
    expect(isSectionNavigable('resume', { ...finished, resumeAvailable: false })).toBe(false);
    expect(isSectionNavigable('career', { ...finished, resumeAvailable: false })).toBe(true);
  });

  it('opens the server-backed diary for signed-in candidates before a career picture exists', () => {
    expect(
      isSectionNavigable('diary', {
        ...firstTime,
        candidateSessionAvailable: true,
        careerDiaryAvailable: true,
      }),
    ).toBe(true);
    expect(isSectionNavigable('diary', firstTime)).toBe(false);
    expect(sectionLockReason('diary', firstTime)).toBe(
      'Войдите в аккаунт, чтобы открыть карьерный дневник',
    );
  });

  it('keeps the diary hidden when the profile has no current place or offer', () => {
    const signedInWithoutWork = { ...finished, careerDiaryAvailable: false };
    expect(isSectionNavigable('diary', signedInWithoutWork)).toBe(false);
    expect(sectionLockReason('diary', signedInWithoutWork)).toContain('текущего места работы');
  });

  it('says why a section is closed, and names the diagnostic first', () => {
    expect(sectionLockReason('tariffs', firstTime)).toContain('диагностику');
    expect(sectionLockReason('resume', firstTime)).toContain('диагностику');
    expect(sectionLockReason('resume', { ...finished, resumeAvailable: false })).toContain(
      'аккаунт',
    );
  });
});
