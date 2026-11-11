/**
 * B643: hh employer pages a company links from its own site. The id is the
 * same on hh.ru, hh.kz, hh.uz and hh.by; no request to hh is made.
 */

/** `hh.<tld>` or its regional subdomain, then `/employer/<digits>`; `\/` covers links inside scripts. */
const HH_EMPLOYER = /(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\.)*hh\.(?:ru|kz|uz|by)\\?\/employer\\?\/(\d{1,12})(?!\d)/gi;
/** More employers than this on the company's pages is a list (partners, clients), not the company. */
const MAX_EMPLOYERS = 3;

export function hhEmployerIds(html: string): readonly string[] {
  const ids = [...new Set(Array.from(html.matchAll(HH_EMPLOYER), (match) => match[1]!))];
  return ids.length > MAX_EMPLOYERS ? [] : ids;
}
