import { seoPreparedSnapshotSchema, seoSourceSuccessSchema, type SeoPreparedSnapshot, type SeoSourceSuccess } from '../shared/seoSourceSnapshot';

type ObjectData = Record<string, unknown>;
const object = (value: unknown): ObjectData => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : {};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const ratio = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const blankMetrics = () => ({ clicks: null, impressions: null, ctr: null, position: null, indexedPages: null, sqi: null });
function window(from: unknown, to: unknown, timezone: 'America/Los_Angeles' | 'provider_defined'): SeoSourceSuccess['window'] {
  const result = seoSourceSuccessSchema.shape.window.safeParse({ from, to, timezone });
  return result.success ? result.data : null;
}
function queries(rows: unknown): SeoSourceSuccess['queries'] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 50).flatMap((value) => {
    const row = object(value);
    const query = typeof row.query === 'string' ? row.query.trim() : Array.isArray(row.keys) && typeof row.keys[0] === 'string' ? row.keys[0].trim() : '';
    if (!query || query.length > 160) return [];
    return [{ query, clicks: number(row.clicks), impressions: number(row.impressions), ctr: ratio(row.ctr), position: number(row.position) }];
  });
}
function reason(value: unknown): NonNullable<SeoPreparedSnapshot['providers']['google']['latestAttempt']>['reason'] {
  if (value === 'credentials_missing' || value === 'network_error') return value;
  if (typeof value === 'string' && /^http_\d{3}$/u.test(value)) return 'http_error';
  return 'provider_unavailable';
}

/** Whitelist projection only. Raw inspections, host/user IDs, credentials and error bodies are never copied. */
export function mergeSeoObservation(previous: SeoPreparedSnapshot, provider: 'google' | 'yandex', raw: unknown, now = new Date()): SeoPreparedSnapshot {
  const result = seoPreparedSnapshotSchema.parse(previous);
  const input = object(raw);
  if (input.mode === 'synthetic_fixture') throw new Error('synthetic_fixture_rejected');
  const observedAt = typeof input.observedAt === 'string' ? input.observedAt : '';
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time) || time > now.getTime() + 300_000) throw new Error('invalid_observation_time');
  if (input.mode !== 'official_api' && input.mode !== 'operational_check') throw new Error('invalid_observation_mode');
  const old = result.providers[provider];
  if (old.latestAttempt && time < Date.parse(old.latestAttempt.observedAt)) throw new Error('out_of_order_observation');
  const available = input.mode === 'official_api' && input.status !== 'unavailable';
  if (!available) {
    old.latestAttempt = { observedAt, mode: input.mode, status: 'unavailable', reason: reason(input.reason) };
  } else {
    const property = provider === 'google' ? input.siteUrl : input.site;
    if (property !== 'https://openqareer.com' && property !== 'https://openqareer.com/') throw new Error('invalid_property_origin');
    const aggregate = provider === 'google' ? object(input.searchAnalytics) : object(input.summary);
    const report = object(provider === 'google' ? input.topQueries : input.queries);
    const aggregateAvailable = provider === 'google' ? Object.keys(aggregate).length > 0 : aggregate.status === 'available';
    const queryAvailable = report.status === 'available' && Array.isArray(report.rows);
    if (!aggregateAvailable && !queryAvailable) {
      old.latestAttempt = { observedAt, mode: 'official_api', status: 'unavailable', reason: 'provider_unavailable' };
    } else {
      const requested = object(input.requestedWindow);
      const success = seoSourceSuccessSchema.parse({
        observedAt, mode: 'official_api',
        window: provider === 'google' ? window(requested.startDate, requested.endDate, 'America/Los_Angeles')
          : window(report.dateFrom, report.dateTo, 'provider_defined'),
        metrics: provider === 'google' ? { ...blankMetrics(), clicks: number(aggregate.clicks), impressions: number(aggregate.impressions), ctr: ratio(aggregate.ctr), position: number(aggregate.position) }
          : { ...blankMetrics(), indexedPages: number(aggregate.indexedPages), sqi: number(aggregate.sqi) },
        queries: queryAvailable ? queries(report.rows) : [],
        sections: { aggregate: aggregateAvailable ? 'available' : 'unavailable', queries: queryAvailable ? 'available' : 'unavailable' },
      });
      old.lastSuccess = success;
      old.latestAttempt = { observedAt, mode: 'official_api', status: aggregateAvailable && queryAvailable ? 'available' : 'partial',
        reason: aggregateAvailable && queryAvailable ? 'none' : 'partial_source' };
    }
  }
  result.preparedAt = now.toISOString();
  return seoPreparedSnapshotSchema.parse(result);
}
