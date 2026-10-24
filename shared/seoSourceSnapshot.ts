import { z } from 'zod';

const timestamp = z.string().datetime();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const count = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
export const seoQuerySchema = z.object({
  query: z.string().trim().min(1).max(160), clicks: count, impressions: count,
  ctr: z.number().finite().min(0).max(1).nullable(), position: count,
}).strict();
export const seoAttemptSchema = z.object({
  observedAt: timestamp, status: z.enum(['available', 'partial', 'unavailable']),
  mode: z.enum(['official_api', 'operational_check']),
  reason: z.enum(['none', 'credentials_missing', 'network_error', 'http_error', 'collector_error',
    'provider_unavailable', 'invalid_observation', 'partial_source']),
}).strict();
export const seoSourceSuccessSchema = z.object({
  observedAt: timestamp, mode: z.literal('official_api'),
  window: z.object({ from: date, to: date, timezone: z.enum(['America/Los_Angeles', 'provider_defined']) })
    .strict().refine((value) => value.from <= value.to).nullable(),
  metrics: z.object({ clicks: count, impressions: count, ctr: z.number().finite().min(0).max(1).nullable(),
    position: count, indexedPages: count, sqi: count }).strict(),
  queries: z.array(seoQuerySchema).max(50),
  sections: z.object({ aggregate: z.enum(['available', 'unavailable']), queries: z.enum(['available', 'unavailable']) }).strict(),
}).strict();
const source = z.object({ latestAttempt: seoAttemptSchema.nullable(), lastSuccess: seoSourceSuccessSchema.nullable() }).strict();
export const seoPreparedSnapshotSchema = z.object({
  schemaVersion: z.literal(1), propertyOrigin: z.literal('https://openqareer.com'), preparedAt: timestamp,
  providers: z.object({ google: source, yandex: source }).strict(),
}).strict();
export type SeoPreparedSnapshot = z.infer<typeof seoPreparedSnapshotSchema>;
export type SeoSourceSuccess = z.infer<typeof seoSourceSuccessSchema>;
export type SeoProviderView = SeoPreparedSnapshot['providers']['google'] & {
  status: 'available' | 'unavailable'; stale: boolean;
};
export type SeoSearchProviders = Record<'google' | 'yandex', SeoProviderView>;
export const emptySeoPreparedSnapshot = (now = new Date().toISOString()): SeoPreparedSnapshot => ({
  schemaVersion: 1, propertyOrigin: 'https://openqareer.com', preparedAt: now,
  providers: { google: { latestAttempt: null, lastSuccess: null }, yandex: { latestAttempt: null, lastSuccess: null } },
});
export function seoProviderViews(snapshot: SeoPreparedSnapshot, now = Date.now()): SeoSearchProviders {
  const view = (item: SeoPreparedSnapshot['providers']['google']): SeoProviderView => ({
    ...item, status: item.lastSuccess ? 'available' : 'unavailable',
    stale: Boolean(item.lastSuccess && (now - Date.parse(item.lastSuccess.observedAt) > 8 * 86_400_000 ||
      (item.latestAttempt?.status === 'unavailable' && Date.parse(item.latestAttempt?.observedAt ?? '') >= Date.parse(item.lastSuccess.observedAt)))),
  });
  return { google: view(snapshot.providers.google), yandex: view(snapshot.providers.yandex) };
}
