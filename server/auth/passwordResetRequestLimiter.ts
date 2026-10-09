import { createHash } from 'node:crypto';

const WINDOW_MS = 60 * 60 * 1_000;
const MAX_REQUESTS = 5;
const MAX_BUCKETS = 10_000;

export class PasswordResetRequestRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private checksSinceCleanup = 0;

  checkAndRecord(identifier: string, clientIp: string, now = Date.now()): number | null {
    this.cleanupExpired(now);
    const dimensions = this.dimensions(identifier, clientIp, now);
    const retryAfter = Math.max(0, ...dimensions.map(({ timestamps }) => {
      if (timestamps.length < MAX_REQUESTS) return 0;
      return Math.max(1, Math.ceil((timestamps[0]! + WINDOW_MS - now) / 1_000));
    }));
    if (retryAfter > 0) return retryAfter;

    const newBuckets = dimensions.filter(({ key }) => !this.buckets.has(key)).length;
    if (this.buckets.size + newBuckets > MAX_BUCKETS) return Math.ceil(WINDOW_MS / 1_000);
    for (const { key, timestamps } of dimensions) {
      timestamps.push(now);
      this.buckets.set(key, timestamps);
    }
    return null;
  }

  reset(): void {
    this.buckets.clear();
    this.checksSinceCleanup = 0;
  }

  private dimensions(identifier: string, clientIp: string, now: number) {
    const cutoff = now - WINDOW_MS;
    return [
      this.bucket('identifier', identifier.trim().toLowerCase(), cutoff),
      this.bucket('ip', clientIp.trim() || 'unknown', cutoff),
    ];
  }

  private bucket(scope: string, value: string, cutoff: number) {
    const digest = createHash('sha256').update(value).digest('hex');
    const key = `${scope}:${digest}`;
    const timestamps = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    return { key, timestamps };
  }

  private cleanupExpired(now: number): void {
    this.checksSinceCleanup += 1;
    if (this.checksSinceCleanup < 256) return;
    this.checksSinceCleanup = 0;
    const cutoff = now - WINDOW_MS;
    for (const [key, timestamps] of this.buckets) {
      const valid = timestamps.filter((timestamp) => timestamp > cutoff);
      if (valid.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, valid);
    }
  }
}

export const defaultPasswordResetRequestRateLimiter = new PasswordResetRequestRateLimiter();
