import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Production serves `script-src 'self' blob:; style-src 'self'`, so any inline
 * `<script>` body or `<style>` block in the entry HTML is silently blocked and
 * logs a console error on every page load — which is exactly what happened
 * until B148 §11. The entry document must therefore carry no executable inline
 * script and no inline stylesheet.
 *
 * `application/ld+json` is data, not script: the browser never executes it and
 * CSP does not block it.
 */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)(?![^>]*type=["']application\/ld\+json["'])[^>]*>[\s\S]*?<\/script>/iu;
const INLINE_STYLE = /<style[\s>]/iu;

describe('entry HTML under the production CSP', () => {
  const html = readFileSync('index.html', 'utf8');

  it('carries no inline script the browser would refuse to run', () => {
    expect(INLINE_SCRIPT.test(html)).toBe(false);
  });

  it('carries no inline stylesheet the browser would refuse to apply', () => {
    expect(INLINE_STYLE.test(html)).toBe(false);
  });

  it('still marks the desktop companion before first paint, from a same-origin file', () => {
    expect(html).toContain('<script src="/desktop-bootstrap.js"></script>');
    const bootstrap = readFileSync('public/desktop-bootstrap.js', 'utf8');
    expect(bootstrap).toContain('is-desktop-companion');
    expect(bootstrap).toContain('__TAURI_INTERNALS__');
  });
});
