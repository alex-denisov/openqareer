import { constants, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { emptySeoPreparedSnapshot, seoPreparedSnapshotSchema, seoProviderViews, type SeoPreparedSnapshot, type SeoSearchProviders } from '../../shared/seoSourceSnapshot';

export const SEO_SNAPSHOT_MAX_BYTES = 128 * 1024;
const CACHE_MS = 10_000;
const cache = new Map<string, { loadedAt: number; snapshot: SeoPreparedSnapshot | null }>();

/** Fixed configured file only. No provider network, archive scan, credential access or request-derived paths. */
export function readPreparedSeoSources(path?: string, now = Date.now()): SeoSearchProviders {
  const unavailable = () => seoProviderViews(emptySeoPreparedSnapshot(new Date(now).toISOString()), now);
  if (!path || !isAbsolute(path)) return unavailable();
  const cached = cache.get(path);
  if (cached && now >= cached.loadedAt && now - cached.loadedAt < CACHE_MS) {
    return cached.snapshot ? seoProviderViews(cached.snapshot, now) : unavailable();
  }
  let snapshot: SeoPreparedSnapshot | null = null;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > SEO_SNAPSHOT_MAX_BYTES) throw new Error('invalid_snapshot_file');
    const buffer = Buffer.alloc(stat.size + 1);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (length !== stat.size) throw new Error('snapshot_changed_during_read');
    snapshot = seoPreparedSnapshotSchema.parse(JSON.parse(buffer.subarray(0, length).toString('utf8')));
    const dates = [snapshot.preparedAt, ...Object.values(snapshot.providers).flatMap((item) => [item.latestAttempt?.observedAt, item.lastSuccess?.observedAt])];
    if (dates.some((value) => value && Date.parse(value) > now + 300_000)) throw new Error('future_snapshot');
  } catch { snapshot = null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
  // Configuration is trusted, but bound cache cardinality too (test/multi-app processes).
  if (cache.size >= 4 && !cache.has(path)) cache.delete(cache.keys().next().value!);
  cache.set(path, { loadedAt: now, snapshot });
  return snapshot ? seoProviderViews(snapshot, now) : unavailable();
}
