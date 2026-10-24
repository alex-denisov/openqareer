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
export function jobPostingEvidence(html) {
  const required = ['datePosted','hiringOrganization','title','description'];
  const nodes = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)]
    .flatMap(match => { try { return graphNodes(JSON.parse(match[1])); } catch { return []; } });
  const posting = nodes.find(item => item['@type'] === 'JobPosting' ||
    (Array.isArray(item['@type']) && item['@type'].includes('JobPosting')));
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
