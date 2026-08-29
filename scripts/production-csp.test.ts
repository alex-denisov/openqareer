import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The PDF inspector is WebAssembly. Chrome refuses to compile any wasm module
 * when `script-src` is set without `'wasm-unsafe-eval'` or `'unsafe-eval'`, so
 * production answered every resume upload with a CompileError no matter how the
 * bytes arrived (INC-028, found live on 2026-08-29). The narrow grant is the
 * only one allowed here: `'unsafe-eval'` would open `eval()` to the whole page.
 */
describe('production Content-Security-Policy', () => {
  const caddyfile = readFileSync('deploy/Caddyfile.openqareer', 'utf8');
  const policy = /Content-Security-Policy\s+"([^"]+)"/u.exec(caddyfile)?.[1] ?? '';

  it('lets the page compile WebAssembly', () => {
    expect(policy).toContain("'wasm-unsafe-eval'");
  });

  it('never opens eval() to buy that', () => {
    expect(policy).not.toContain("'unsafe-eval'");
  });
});
