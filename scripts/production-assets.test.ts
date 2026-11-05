import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Hashed build files are served by Caddy from disk (prod 02.11); connections stay open (PRB-041). */
describe('production asset delivery', () => {
  const caddyfile = readFileSync('deploy/Caddyfile.openqareer', 'utf8');

  it('serves /assets from the current release, then the previous one, from disk', () => {
    expect(caddyfile).toContain('try_files /current{path} /previous{path}');
    expect(caddyfile).toMatch(
      /handle @assetFile \{\s*root \* \/srv\/openqareer\s*rewrite \* \{http\.matchers\.file\.relative\}\s*file_server\s*\}/u,
    );
  });

  it('multiplexes over kept-alive HTTP/2 connections instead of closing each one (PRB-041)', () => {
    expect(caddyfile).toMatch(/^\s*protocols h1 h2$/mu);
    expect(caddyfile).not.toMatch(/^\s*Connection "close"$/mu);
  });

  it('keeps the asset cache headers, compression and the relay trust', () => {
    expect(caddyfile).toContain(
      'header @assets Cache-Control "public, max-age=31536000, immutable"',
    );
    expect(caddyfile).toContain('header @assets Cache-Control "no-store"');
    expect(caddyfile).toContain('encode gzip');
    expect(caddyfile).toContain('trusted_proxies static 107.172.153.202/32');
  });

  it('logs only Googlebot responses, without headers, with a size and age limit', () => {
    expect(caddyfile).toMatch(/@notGooglebot not client_ip .*66\.249\.76\.0\/23/u);
    expect(caddyfile).toContain('log_skip @notGooglebot');
    expect(caddyfile).toContain('output file /var/log/caddy/googlebot-access.log');
    expect(caddyfile).toContain('roll_size 10MiB');
    expect(caddyfile).toContain('roll_keep 5');
    expect(caddyfile).toContain('roll_keep_for 336h');
    expect(caddyfile).toContain('request>headers delete');
    expect(caddyfile).toContain('resp_headers delete');
  });

  it('sends www to the apex with the path and query kept (03.11: www was NXDOMAIN)', () => {
    expect(caddyfile).toMatch(
      /^www\.openqareer\.com \{\s*redir https:\/\/openqareer\.com\{uri\} permanent\s*\}$/mu,
    );
  });
});
