import type { ConnectionPlatform } from './platformLabels';
import {
  openConnectorSession,
  sessionOpenFailureMessage,
  type ConnectorSessionStep,
  type SessionLayout,
  type SessionOpenResult,
} from './connectorSession';

export interface ConnectorSessionStartDependencies {
  readonly platform: ConnectionPlatform;
  readonly url: string;
  /**
   * Measures the frame the native window has to cover. It can only be read
   * once the session frame is on screen, which is why the step announces
   * `opening` before this is called.
   */
  readonly measureLayout: () => SessionLayout | undefined;
  /** Lets the session frame paint before the native window is placed over it. */
  readonly waitForFrame: () => Promise<void>;
  /** Every step transition, in the order the candidate sees it. */
  readonly onStep: (step: ConnectorSessionStep) => void;
  readonly openSession?: (
    platform: ConnectionPlatform,
    url: string,
    layout?: SessionLayout,
  ) => Promise<SessionOpenResult>;
}

export interface ConnectorSessionStartResult {
  readonly opened: boolean;
  /** Ready to show; only present when the window never appeared. */
  readonly error?: string;
}

/**
 * Opens the platform's sign-in window and reports the step transitions.
 *
 * The order is the whole point. `session_open` is what turns the session poll
 * on, and the poll asks the desktop shell to inspect a window; announcing that
 * step before the window exists made the very first poll fail with
 * `session_window_missing`, which threw the flow back to `idle` (hh.ru) or
 * printed "вход выполнен, но данные получить не удалось" (LinkedIn) before the
 * candidate had typed anything. The sign-in they then completed had nothing
 * left watching it (owner report, B157).
 */
export async function startConnectorSession(
  dependencies: ConnectorSessionStartDependencies,
): Promise<ConnectorSessionStartResult> {
  dependencies.onStep('opening');
  await dependencies.waitForFrame();
  const layout = dependencies.measureLayout();
  const open = dependencies.openSession ?? openConnectorSession;
  const result = await open(dependencies.platform, dependencies.url, layout);
  if (!result.opened) {
    dependencies.onStep('idle');
    return {
      opened: false,
      error: sessionOpenFailureMessage(dependencies.platform, result.reason),
    };
  }
  dependencies.onStep('session_open');
  return { opened: true };
}

/** Resolves after the browser has had a frame to lay the session frame out. */
export function nextAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export interface AutomaticSessionOpenInput {
  /** The dialog is on screen. */
  readonly isOpen: boolean;
  /** Only the desktop app can open a platform session at all. */
  readonly isDesktop: boolean;
  /** Where the session currently stands. */
  readonly step: ConnectorSessionStep;
  /** An open has already been attempted for this dialog. */
  readonly attempted: boolean;
}

/**
 * Whether the dialog should open the sign-in window by itself.
 *
 * «Подключить» used to open a dialog that explained what was about to happen
 * and offered a second button to make it happen. The explanation was the same
 * every time and the candidate had no decision to make there, so the owner
 * asked for the dialog to open the browser session outright (B169 §3).
 *
 * It stays a one-shot: after a failed attempt the dialog shows the error and
 * the manual button, because retrying on its own would reopen a window the
 * candidate may have deliberately dismissed.
 */
export function shouldOpenSessionAutomatically(
  input: AutomaticSessionOpenInput,
): boolean {
  if (!input.isOpen || !input.isDesktop) return false;
  if (input.attempted) return false;
  return input.step === 'idle';
}

export interface SessionPollInput {
  /** The dialog is on screen. */
  readonly isOpen: boolean;
  /** Only the desktop app can inspect a platform session at all. */
  readonly isDesktop: boolean;
  /** Where the session currently stands. */
  readonly step: ConnectorSessionStep;
  /** This opening of the dialog really did put a window on screen. */
  readonly sessionOpened: boolean;
  /** The flow stopped polling on purpose after a failure it already reported. */
  readonly paused: boolean;
}

/**
 * Whether the dialog may inspect the platform's session window right now.
 *
 * `step` alone was not enough. A dialog that closed on `session_open` reopens
 * still holding that step for one render, and the poll effect fires before the
 * reset does — asking the shell to inspect a window that no longer exists. The
 * candidate saw «Окно входа закрыто. Откройте его снова» printed over a session
 * that was opening at that very moment (owner report, 2026-08-26). Only the
 * window this opening actually opened may be polled.
 */
export function shouldPollConnectorSession(input: SessionPollInput): boolean {
  if (!input.isOpen || !input.isDesktop) return false;
  if (!input.sessionOpened || input.paused) return false;
  return input.step === 'session_open';
}
