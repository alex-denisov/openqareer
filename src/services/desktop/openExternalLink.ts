import { isTauriEnvironment } from './desktopBridge';

/**
 * One place to open an external URL (job board, source link) so a WebView
 * never gets a dead `target="_blank"` anchor (B266): Tauri's WebView does not
 * spawn a system browser tab for those, so desktop opens links through
 * `tauri-plugin-shell`'s `open` command while the web build keeps
 * `window.open`.
 */
export async function openExternalLink(url: string): Promise<void> {
  if (!url) return;
  if (isTauriEnvironment()) {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return;
  }
  window.open(url, '_blank', 'noopener');
}
