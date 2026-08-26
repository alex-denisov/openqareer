import { describe, expect, it } from 'vitest';
import { shouldOpenSessionAutomatically } from './connectorSessionStart';

const desktopDialogJustOpened = {
  isOpen: true,
  isDesktop: true,
  step: 'idle',
  attempted: false,
} as const;

describe('automatic connector session open', () => {
  /**
   * B169 §3 — the owner's words: «при попытках подключения LinkedIn и hh.ru
   * не было промежуточного модального окна, достаточно того что модальное
   * окно сразу открывает браузерную сессию».
   */
  it('opens the sign-in window as soon as the dialog appears in the app', () => {
    expect(shouldOpenSessionAutomatically(desktopDialogJustOpened)).toBe(true);
  });

  it('does nothing while the dialog is closed', () => {
    expect(
      shouldOpenSessionAutomatically({ ...desktopDialogJustOpened, isOpen: false }),
    ).toBe(false);
  });

  it('does nothing on the web, where no platform session can be opened', () => {
    expect(
      shouldOpenSessionAutomatically({ ...desktopDialogJustOpened, isDesktop: false }),
    ).toBe(false);
  });

  it('never reopens a window that is already on its way or on screen', () => {
    for (const step of ['opening', 'session_open'] as const) {
      expect(shouldOpenSessionAutomatically({ ...desktopDialogJustOpened, step })).toBe(
        false,
      );
    }
  });

  /**
   * A candidate who closed the sign-in window, or whose window failed to
   * appear, is back at `idle`. Opening again on its own would fight them.
   */
  it('is a one-shot: a second open is the candidate’s decision', () => {
    expect(
      shouldOpenSessionAutomatically({ ...desktopDialogJustOpened, attempted: true }),
    ).toBe(false);
  });
});
