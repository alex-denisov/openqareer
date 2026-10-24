import { JSDOM } from 'jsdom';

export function inspectionLimit(value) {
  const limit = value == null || value === '' ? 20 : Number(value);
  if (!Number.isInteger(limit) || limit < 0 || limit > 50)
    throw new Error('GOOGLE_SEO_INSPECTION_LIMIT must be an integer from 0 to 50');
  return limit;
}
export function selectRootSitemap(sitemaps) {
  return sitemaps.find(item => item.path === 'https://openqareer.com/sitemap.xml');
}
function graphNodes(value) {
  if (Array.isArray(value)) return value.flatMap(graphNodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...graphNodes(value['@graph'])];
}
function microdataPosting(html) {
  // Parse inert markup only; scripts and external resources are never executed.
  const dom = new JSDOM(html);
  try {
    for (const root of dom.window.document.querySelectorAll('[itemscope][itemtype]')) {
      if (!root.getAttribute('itemtype').split(/\s+/u).some(type => /^https?:\/\/schema\.org\/JobPosting$/u.test(type))) continue;
      const properties = [...root.querySelectorAll('[itemprop]')]
        .filter(element => element.parentElement?.closest('[itemscope]') === root);
      const value = name => {
        const element = properties.find(item => item.getAttribute('itemprop').split(/\s+/u).includes(name));
        if (!element) return undefined;
        if (element.hasAttribute('itemscope')) return element.textContent.trim() ||
          [...element.querySelectorAll('[content]')].some(child => child.getAttribute('content')?.trim()) ? {} : undefined;
        return element.getAttribute('content') ?? element.getAttribute('datetime') ?? element.getAttribute('href') ?? element.textContent.trim();
      };
      return Object.fromEntries(['datePosted','hiringOrganization','title','description','jobLocation','jobLocationType','applicantLocationRequirements'].map(name => [name,value(name)]));
    }
  } finally { dom.window.close(); }
  return undefined;
}
export function jobPostingEvidence(html) {
  const required = ['datePosted','hiringOrganization','title','description'];
  const nodes = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)]
    .flatMap(match => { try { return graphNodes(JSON.parse(match[1])); } catch { return []; } });
  const posting = nodes.find(item => item['@type'] === 'JobPosting' ||
    (Array.isArray(item['@type']) && item['@type'].includes('JobPosting'))) ?? microdataPosting(html);
  const missing = posting ? required.filter(name => posting[name] == null || posting[name] === '') : [...required];
  if (posting && !posting.jobLocation &&
    !(posting.jobLocationType === 'TELECOMMUTE' && posting.applicantLocationRequirements)) missing.push('jobLocation');
  return { jobPosting: Boolean(posting), missing };
}
/** Only our bounded static diagnostics may reach stdout; never parser/provider body excerpts. */
export function publicGoogleError(error) {
  const message = error instanceof Error ? error.message : '';
  return /^(?:Google OAuth2 HTTP \d{3}|Google OAuth2 invalid token response|Search Console [A-Za-z ]+ HTTP \d{3}|Search Console invalid JSON response|GOOGLE_SEO_INSPECTION_LIMIT must be an integer from 0 to 50)$/u.test(message)
    ? message : 'Источник недоступен или ответ не прошёл проверку';
}
