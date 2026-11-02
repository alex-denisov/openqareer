import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Hashed build files are served by Caddy from disk (prod 02.11); INC-004 delivery stays as it was. */
describe('production asset delivery', () => {
  const caddyfile = readFileSync('deploy/Caddyfile.openqareer', 'utf8');

  it('serves /assets from the current release, then the previous one, from disk', () => {
    expect(caddyfile).toContain('try_files /current{path} /previous{path}');
    expect(caddyfile).toMatch(/handle @assetFile \{\s*root \* \/srv\/openqareer\s*rewrite \* \{http\.matchers\.file\.relative\}\s*file_server\s*\}/u);
  });

  it('keeps the INC-004 delivery settings and asset cache headers', () => {
    expect(caddyfile).toContain('protocols h1');
    expect(caddyfile).toContain('Connection "close"');
    expect(caddyfile).toContain('header @assets Cache-Control "public, max-age=31536000, immutable"');
    expect(caddyfile).toContain('header @assets Cache-Control "no-store"');
    expect(caddyfile).toContain('encode gzip');
    expect(caddyfile).toContain('trusted_proxies static 107.172.153.202/32');
  });
});
