import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public discovery metadata', () => {
  it('describes the candidate product truthfully in the entry document', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(
      /<meta name="description" content="[^"]{80,180}">/u,
    );
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
