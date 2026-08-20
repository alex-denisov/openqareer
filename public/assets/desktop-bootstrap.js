/**
 * Marks the document as the desktop companion before first paint.
 *
 * This used to be an inline <script> and an inline <style> in index.html; the
 * production CSP is `script-src 'self'` / `style-src 'self'`, so the browser
 * blocked both and logged two console errors on every page load (B148 §11).
 * A same-origin file is allowed, runs at the same moment in the parse, and the
 * matching rule now lives in the stylesheet.
 *
 * It sits under `/assets/` on purpose: INC-018 has production's Caddy rewriting
 * every root-level path to `index.html`, so a file served from `/` would come
 * back as HTML and be refused for its MIME type. `/assets/` is served
 * correctly today and stays correct once INC-018 is applied.
 */
(function () {
  try {
    if (
      typeof window !== 'undefined' &&
      (window.__TAURI_INTERNALS__ ||
        window.__TAURI__ ||
        window.location.protocol === 'tauri:' ||
        window.location.protocol === 'asset:' ||
        window.location.host === 'tauri.localhost' ||
        window.location.port === '1420')
    ) {
      document.documentElement.classList.add('is-desktop-companion');
    }
  } catch (_error) {
    // A blocked storage or protocol read must never stop the app from booting.
  }
})();
