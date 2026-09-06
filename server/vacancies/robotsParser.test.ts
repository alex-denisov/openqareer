import { describe, expect, it } from 'vitest';
import {
  evaluateRobotsPolicy,
  isPathAllowed,
  parseCrawlDelay,
  parseRobotsDirectives,
} from './robotsParser';

describe('robotsParser (RFC 9309)', () => {
  const SAMPLE_ROBOTS = `
# Sample robots.txt
User-agent: Googlebot
Disallow: /private/
Allow: /

User-agent: *
Disallow: /admin/
Disallow: /internal/
Allow: /admin/public/
Allow: /api/public/
Disallow: /api/
Crawl-delay: 5
`;

  it('parses directives for wildcard user-agent', () => {
    const directives = parseRobotsDirectives(SAMPLE_ROBOTS, '*');
    expect(directives.crawlDelaySeconds).toBe(5);
    expect(directives.disallow).toEqual(['/admin/', '/internal/', '/api/']);
    expect(directives.allow).toEqual(['/admin/public/', '/api/public/']);
  });

  it('allows root and non-disallowed paths', () => {
    expect(isPathAllowed('/', SAMPLE_ROBOTS, '*')).toBe(true);
    expect(isPathAllowed('/vacancies', SAMPLE_ROBOTS, '*')).toBe(true);
    expect(isPathAllowed('/careers/openings', SAMPLE_ROBOTS, '*')).toBe(true);
  });

  it('blocks disallowed paths', () => {
    expect(isPathAllowed('/admin/dashboard', SAMPLE_ROBOTS, '*')).toBe(false);
    expect(isPathAllowed('/internal/metrics', SAMPLE_ROBOTS, '*')).toBe(false);
    expect(isPathAllowed('/api/secret', SAMPLE_ROBOTS, '*')).toBe(false);
  });

  it('respects longest match rule where Allow beats Disallow', () => {
    // /admin/public/ (14 chars) vs /admin/ (7 chars) -> Allow wins
    expect(isPathAllowed('/admin/public/list', SAMPLE_ROBOTS, '*')).toBe(true);
    // /api/public/ (12 chars) vs /api/ (5 chars) -> Allow wins
    expect(isPathAllowed('/api/public/jobs', SAMPLE_ROBOTS, '*')).toBe(true);
  });

  it('handles wildcard and end-of-line patterns in robots.txt', () => {
    const robots = `
User-agent: *
Disallow: /*.pdf$
Disallow: /temp/*/cache/
`;
    expect(isPathAllowed('/resume.pdf', robots, '*')).toBe(false);
    expect(isPathAllowed('/resume.pdf.html', robots, '*')).toBe(true);
    expect(isPathAllowed('/temp/user123/cache/', robots, '*')).toBe(false);
    expect(isPathAllowed('/temp/user123/other/', robots, '*')).toBe(true);
  });

  it('extracts crawl-delay as float or integer seconds', () => {
    expect(parseCrawlDelay('User-agent: *\nCrawl-delay: 2.5', '*')).toBe(2.5);
    expect(parseCrawlDelay('User-agent: *\nCrawl-delay: 10', '*')).toBe(10);
    expect(parseCrawlDelay('User-agent: *\nDisallow: /', '*')).toBeNull();
    expect(parseCrawlDelay('User-agent: *\nCrawl-delay: invalid', '*')).toBeNull();
  });

  it('evaluates HTTP status codes per RFC 9309 §2.3.1', () => {
    // 404 Not Found -> policy absent, everything allowed
    const on404 = evaluateRobotsPolicy({ httpStatus: 404, path: '/careers' });
    expect(on404.verdict).toBe('allowed');
    expect(on404.crawlDelaySeconds).toBeNull();

    // 500 Server Error -> fail-closed unconfirmed (do not crawl until robots.txt recovers)
    const on500 = evaluateRobotsPolicy({ httpStatus: 500, path: '/careers' });
    expect(on500.verdict).toBe('unconfirmed');

    // 403 Forbidden on robots.txt -> disallowed
    const on403 = evaluateRobotsPolicy({ httpStatus: 403, path: '/careers' });
    expect(on403.verdict).toBe('disallowed');

    // 200 with Disallow: /
    const onDisallowAll = evaluateRobotsPolicy({
      httpStatus: 200,
      robotsTxtContent: 'User-agent: *\nDisallow: /',
      path: '/careers',
    });
    expect(onDisallowAll.verdict).toBe('disallowed');

    // 200 with Allow: / and Crawl-delay: 3
    const onAllowedWithDelay = evaluateRobotsPolicy({
      httpStatus: 200,
      robotsTxtContent: 'User-agent: *\nAllow: /\nCrawl-delay: 3',
      path: '/careers',
    });
    expect(onAllowedWithDelay.verdict).toBe('allowed');
    expect(onAllowedWithDelay.crawlDelaySeconds).toBe(3);
  });
});
