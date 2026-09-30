import { isTauriEnvironment } from './desktopBridge';

/**
 * WebKit keeps `localStorage` writes in memory and flushes them lazily, so a
 * quit or a reinstall lost the token and signed the owner out on every restart
 * (B327). The desktop app also saves the token itself, synchronously, and puts
 * it back at start when WebKit lost its copy.
 */

async function invokeTokenCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Fire-and-forget mirror of every sign-in and sign-out; the browser build does nothing. */
export function mirrorDesktopSessionToken(token: string | null): void {
  if (!isTauriEnvironment()) return;
  void invokeTokenCommand('write_session_token', { token }).catch(() => undefined);
}

export type RestoreDependencies = {
  readonly readSaved: () => Promise<string | null>;
  readonly getLocal: () => string | null;
  readonly setLocal: (token: string) => void;
};

/** True when a token was put back into `localStorage`. */
export async function restoreDesktopSessionToken(deps: RestoreDependencies): Promise<boolean> {
  if (deps.getLocal()) return false;
  let saved: string | null;
  try {
    saved = await deps.readSaved();
  } catch {
    return false;
  }
  if (!saved) return false;
  deps.setLocal(saved);
  return true;
}

export function readSavedDesktopSessionToken(): Promise<string | null> {
  if (!isTauriEnvironment()) return Promise.resolve(null);
  return invokeTokenCommand<string | null>('read_session_token');
}
