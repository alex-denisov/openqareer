import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANDING_TITLE } from '../src/features/site/siteTitles';
import { buildLlmsTxt } from '../shared/aeoSurface';

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
    // B209 — витрина больше не лежит ручным файлом: её собирает предрендер из
    // того же источника, что и продукт, поэтому проверяем генератор.
    const llms = buildLlmsTxt();
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/\n/u);
    // B173: the published legal pack has to be discoverable, so robots names
    // the sitemap that lists it.
    expect(robots).toContain('Sitemap: https://openqareer.com/sitemap.xml');
    expect(llms).toMatch(/^# openqareer\n/u);
    expect(llms).toContain('https://openqareer.com');
    expect(llms).not.toMatch(/гарантирует (работу|оффер|интервью)/iu);
  });

  /**
   * Подтверждение прав в Вебмастере и Search Console держится на мета-теге в
   * корневом документе. Потерять его при следующей правке `<head>` — потерять
   * доступ к данным поиска, причём молча: сайт просто перестанет быть
   * подтверждённым (B209).
   */
  it('keeps the search-console verification tags that prove domain ownership (B209)', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain(
      '<meta name="google-site-verification" content="mUXfqE5gjjwO1OkPksbiRk6t7UYfQ4nFK1N82UZdOTQ">',
    );
    expect(html).toContain('<meta name="yandex-verification" content="c64c7773544f50fe">');
  });

  it('keeps the entry document title in exact sync with the hydrated landing title (B162)', () => {
    const html = readFileSync('index.html', 'utf8');
    const match = /<title>([^<]+)<\/title>/u.exec(html);
    expect(match?.[1]).toBe(LANDING_TITLE);
  });
});
