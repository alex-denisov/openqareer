export const SEARCH_CONSOLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Search Console dates are Pacific calendar dates; request 28 completed days. */
export function searchAnalyticsWindow(now = new Date()) {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const end = new Date(`${fields.year}-${fields.month}-${fields.day}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

/** Read-only API, bounded top-query rows. Never print provider bodies or credentials. */
export async function querySearchAnalytics(accessToken, siteUrl, {
  fetcher = fetch, byQuery = false, now = new Date(),
} = {}) {
  const window = searchAnalyticsWindow(now);
  const response = await fetcher(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...window, dataState: 'final', rowLimit: byQuery ? 50 : 1,
        ...(byQuery ? { dimensions: ['query'] } : {}) }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`Search Console SearchAnalytics API HTTP ${response.status}`);
  return { ...await readSearchConsoleJson(response), requestedWindow: window };
}

/** Missing source rows stay unknown rather than turning into a zero-position claim. */
export function searchAnalyticsTotals(data) {
  const row = data.rows?.[0];
  return Object.fromEntries(['clicks', 'impressions', 'ctr', 'position'].map(name => [
    name, typeof row?.[name] === 'number' && Number.isFinite(row[name]) ? row[name] : null,
  ]));
}

/** Exchange only against the fixed Google endpoint; error bodies may contain private input. */
export async function exchangeSearchConsoleToken(assertion, { fetcher = fetch } = {}) {
  const response = await fetcher(SEARCH_CONSOLE_TOKEN_URL, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  });
  if (!response.ok) throw new Error(`Google OAuth2 HTTP ${response.status}`);
  const body = await readSearchConsoleJson(response);
  if (typeof body.access_token !== 'string' || !body.access_token)
    throw new Error('Google OAuth2 invalid token response');
  return body.access_token;
}

export async function readSearchConsoleJson(response) {
  try { return await response.json(); }
  catch { throw new Error('Search Console invalid JSON response'); }
}
