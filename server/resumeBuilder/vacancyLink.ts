/**
 * B567: the pool id a vacancy link maps to without reading the pool. hh.ru
 * and LinkedIn records are keyed by the platform's own vacancy number (≈71 %
 * of the pool on 27.10.2026), so the lookup is one primary-key read. Other
 * links are not searched: a URL scan of the 1.1 M-row index takes ~0.6 s of
 * the event loop on prod.
 */
export function poolIdFromVacancyLink(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const host = url.hostname.toLowerCase();
  if (host === 'hh.ru' || host.endsWith('.hh.ru')) {
    const match = /^\/vacancy\/(\d{4,12})\/?$/u.exec(url.pathname);
    return match ? `src-hh-search:${match[1]}` : undefined;
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    const view = /^\/jobs\/view\/(?:[^/]*-)?(\d{6,14})\/?$/u.exec(url.pathname);
    const current = url.searchParams.get('currentJobId');
    const id = view?.[1] ?? (current && /^\d{6,14}$/u.test(current) ? current : undefined);
    return id ? `src-linkedin-guest:${id}` : undefined;
  }
  return undefined;
}
