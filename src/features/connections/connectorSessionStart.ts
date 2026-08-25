import type { ConnectionPlatform } from './connectionResult';
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
