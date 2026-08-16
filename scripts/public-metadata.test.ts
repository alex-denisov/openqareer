import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public discovery metadata', () => {
  it('describes the candidate product truthfully in the entry document', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(
      /<meta name="description" content="[^"]{80,180}">/u,
    );
  });

  it('links brand icons and a share image that actually exist (B138)', () => {
    const html = readFileSync('index.html', 'utf8');
    // `data:,` was the stand-in that left the browser tab blank.
    expect(html).not.toContain('href="data:,"');

    const icon = /<link rel="icon" href="(\/[^"]+)"/u.exec(html);
    const touchIcon = /<link rel="apple-touch-icon" href="(\/[^"]+)"/u.exec(html);
    const share = /<meta property="og:image" content="https:\/\/openqareer\.com(\/[^"]+)"/u.exec(
      html,
    );
    expect(icon).not.toBeNull();
    expect(touchIcon).not.toBeNull();
    expect(share).not.toBeNull();

    for (const match of [icon, touchIcon, share]) {
      expect(existsSync(`public${match![1]}`)).toBe(true);
    }
    expect(readFileSync('public/favicon.svg', 'utf8')).toContain('openqareer');
  });

  it('publishes explicit crawler and LLM discovery files', () => {
    const robots = readFileSync('public/robots.txt', 'utf8');
    const llms = readFileSync('public/llms.txt', 'utf8');
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/\n$/u);
    expect(llms).toMatch(/^# openqareer\n/u);
    expect(llms).toContain('https://openqareer.com');
    expect(llms).not.toMatch(/гарантирует (работу|оффер|интервью)/iu);
  });
});
