const API = 'https://api.webmaster.yandex.net/v4';
const SITE = 'https://openqareer.com';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const unavailable = reason => ({ status: 'unavailable', reason });
function isProperty(host) {
  try { return new URL(host.ascii_host_url).origin === SITE && host.verified === true; }
  catch { return false; }
}
function queryRows(data) {
  if (!Array.isArray(data.queries)) return unavailable('invalid_response');
  return {
    status: 'available', dateFrom: data.date_from ?? null, dateTo: data.date_to ?? null,
    rows: data.queries.slice(0, 50).map(row => {
      const clicks = number(row.indicators?.TOTAL_CLICKS);
      const impressions = number(row.indicators?.TOTAL_SHOWS);
      return { query: String(row.query_text ?? ''), clicks, impressions,
        ctr: clicks !== null && impressions > 0 ? clicks / impressions : null,
        position: number(row.indicators?.AVG_SHOW_POSITION) };
    }),
  };
}
async function ask(path, token, fetcher) {
  try {
    const response = await fetcher(API + path, {
      method: 'GET', headers: { Authorization: `OAuth ${token}` },
      signal: AbortSignal.timeout(15_000), redirect: 'error',
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) return unavailable(
      /^[A-Z_]{1,64}$/u.test(body?.error_code ?? '') ? body.error_code : `http_${response.status}`,
    );
    return body ? { status: 'available', data: body } : unavailable('invalid_json');
  } catch { return unavailable('network_error'); }
}

/** Read-only, fixed property, bounded queries. Provider IDs and credentials never enter output. */
export async function collectYandexWebmaster(token, { fetcher = fetch, now = new Date() } = {}) {
  if (!token) return unavailable('credentials_missing');
  const user = await ask('/user', token, fetcher);
  if (user.status !== 'available') return user;
  const id = String(user.data.user_id ?? '');
  if (!/^\d+$/u.test(id)) return unavailable('invalid_user_response');
  const hosts = await ask(`/user/${id}/hosts`, token, fetcher);
  if (hosts.status !== 'available') return hosts;
  const host = Array.isArray(hosts.data.hosts) ? hosts.data.hosts.find(isProperty) : undefined;
  if (!host) return unavailable('verified_property_missing');
  const prefix = `/user/${id}/hosts/${encodeURIComponent(host.host_id)}`;
  const [summary, queries, quota, sitemaps] = await Promise.all([
    '/summary', '/search-queries/popular?order_by=TOTAL_CLICKS&limit=50&offset=0',
    '/recrawl/quota', '/sitemaps',
  ].map(path => ask(prefix + path, token, fetcher)));
  return { provider: 'yandex_webmaster', observedAt: now.toISOString(), site: SITE,
    summary: summary.status !== 'available' ? summary : {
      status: 'available', sqi: number(summary.data.sqi),
      indexedPages: number(summary.data.searchable_pages_count),
      excludedPages: number(summary.data.excluded_pages_count),
    },
    queries: queries.status === 'available' ? queryRows(queries.data) : queries,
    quota: quota.status !== 'available' ? quota : {
      status: 'available', daily: number(quota.data.daily_quota), remaining: number(quota.data.quota_remainder),
    },
    sitemaps: sitemaps.status !== 'available' ? sitemaps : {
      status: Array.isArray(sitemaps.data.sitemaps) ? 'available' : 'unavailable',
      rows: (Array.isArray(sitemaps.data.sitemaps) ? sitemaps.data.sitemaps : []).slice(0, 100).map(row => ({ url: row.sitemap_url ?? null })),
    },
  };
}
