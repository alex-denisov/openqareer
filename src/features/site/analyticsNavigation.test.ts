import { describe, expect, it } from 'vitest';
import { analyticsBoundary, requiresAnalyticsDocumentNavigation } from './analyticsNavigation';

describe('analytics document boundaries', () => {
  it.each([
    ['/', '/tools/country-fit'],
    ['/faq', '/salaries/backend-developer'],
    ['/tools/country-fit', '/signup'],
    ['/salaries', '/app'],
    ['/', '/login'],
    ['/app', '/'],
    ['/tools/country-fit', '/faq'],
  ])('restarts the document between %s and %s', (from, to) => {
    expect(requiresAnalyticsDocumentNavigation(from, to)).toBe(true);
  });
  it.each([
    ['/', '/faq'],
    ['/faq?search=ats', '/support'],
    ['/app', '/app/profile'],
    ['/app/profile', '/app/opportunities'],
    ['/login', '/signup'],
    ['/tools/country-fit', '/salaries/software-engineer'],
  ])('retains ordinary SPA navigation between %s and %s', (from, to) => {
    expect(requiresAnalyticsDocumentNavigation(from, to)).toBe(false);
  });
  it('preserves desktop routing and does not introduce external redirect behavior', () => {
    expect(requiresAnalyticsDocumentNavigation('/', '/login', true)).toBe(false);
    for (const path of [
      'https://example.test',
      '//example.test',
      '/\\example.test',
      '/\n/example.test',
      '/\t/example.test',
    ])
      expect(requiresAnalyticsDocumentNavigation('/', path)).toBe(false);
    expect(analyticsBoundary('/tools/country-fit/?income=50000')).toBe('tool');
    expect(analyticsBoundary('/signup')).toBe('untracked');
    expect(requiresAnalyticsDocumentNavigation('/tools/country-fit', '/\napp')).toBe(true);
  });
});
