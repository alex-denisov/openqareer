import { isTauriEnvironment } from './desktopBridge';

/**
 * One place to open an external URL (job board, source link) so a WebView
 * never gets a dead `target="_blank"` anchor (B266): Tauri's WebView does not
 * spawn a system browser tab for those, so desktop opens links through
 * the `open_external_url` command (http(s) only, checked in Rust too) while the web build keeps
 * `window.open`. Resolves `false` when the link could not be opened.
 */
export async function openExternalLink(url: string): Promise<boolean> {
  if (!isWebUrl(url)) return false;
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('open_external_url', { url });
      return true;
    } catch {
      return false;
    }
  }
  // With `noopener` window.open always returns null, so there is no signal.
  window.open(url, '_blank', 'noopener');
  return true;
}

/** Vacancy links come from third-party boards: only http(s) ever reaches the OS. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
