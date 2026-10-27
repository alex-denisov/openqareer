export type AnalyticsBoundary = 'public' | 'tool' | 'untracked';

const INTERNAL_ORIGIN = 'https://openqareer.invalid';
function internalUrl(path: string): URL | undefined {
  try {
    const url = new URL(path, INTERNAL_ORIGIN);
    return url.origin === INTERNAL_ORIGIN ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Keep these boundaries aligned with the consent loader in oq-analytics-3.js. */
export function analyticsBoundary(path: string): AnalyticsBoundary {
  const url = internalUrl(path);
  if (!url) return 'untracked';
  const pathname = url.pathname.replace(/\/$/u, '') || '/';
  if (
    pathname === '/tools/country-fit' ||
    pathname === '/tools/interview-questions' ||
    /^\/tools\/interview-questions\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(pathname) ||
    pathname === '/salaries' ||
    /^\/salaries\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(pathname)
  )
    return 'tool';
  if (
    pathname === '/' ||
    pathname === '/faq' ||
    pathname === '/support' ||
    pathname.startsWith('/legal/')
  )
    return 'public';
  return 'untracked';
}

export function requiresAnalyticsDocumentNavigation(
  from: string,
  to: string,
  isDesktop = false,
): boolean {
  // Do not broaden the SPA router's authority to external or backslash URLs.
  if (isDesktop || !to.trim().startsWith('/') || !internalUrl(to)) return false;
  return analyticsBoundary(from) !== analyticsBoundary(to);
}
