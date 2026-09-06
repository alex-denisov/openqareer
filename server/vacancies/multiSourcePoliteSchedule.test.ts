import { describe, expect, it, vi } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';

describe('MultiSourceVacancyEngine polite scheduling (B204)', () => {
  const BASE_TIME = Date.now();

  const makeVacancy = (id: string, sourceId: string): UnifiedVacancy => ({
    id,
    fingerprint: `fp-${id}`,
    title: 'Senior Engineer',
    company: 'Acme Corp',
    isRemote: true,
    description: 'Senior Engineer specializing in TypeScript and resilient backend systems.',
    url: `https://example.com/${id}`,
    publishedAt: new Date(BASE_TIME).toISOString(),
    status: 'active',
    requiredSkills: ['TypeScript'],
    provenance: {
      sourceId,
      sourceType: 'json_api',
      sourceUrl: `https://example.com/${id}`,
      observedAt: new Date(BASE_TIME).toISOString(),
    },
  });

  it('backs off politely on 429 rate limit errors and skips in syncDue during backoff', async () => {
    let fail429 = true;
    const fetcher = vi.fn(async () => {
      if (fail429) {
        const err = new Error('HTTP 429 Too Many Requests');
        (err as unknown as { statusCode: number }).statusCode = 429;
        throw err;
      }
      return [makeVacancy('v-1', 'src-rate-limited')];
    });

    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          id: 'src-rate-limited',
          name: 'Rate Limited Source',
          type: 'json_api',
          enabled: true,
          targetUrl: 'https://example.com/api',
          refreshIntervalMinutes: 30,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
        },
      ],
      fetcher,
    });

    // 1. Initial attempt fails with 429
    const outcomes1 = await engine.syncDue(BASE_TIME);
    expect(outcomes1[0].status).toBe('error');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 2. 5 minutes later (429 backoff is 15 minutes minimum): syncDue must skip it
    fetcher.mockClear();
    const outcomes2 = await engine.syncDue(BASE_TIME + 5 * 60_000);
    expect(outcomes2).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();

    // 3. 16 minutes later: backoff has elapsed, syncDue retries
    fail429 = false;
    const outcomes3 = await engine.syncDue(BASE_TIME + 16 * 60_000);
    expect(outcomes3).toHaveLength(1);
    expect(outcomes3[0].status).toBe('healthy');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('skips sources disallowed by robots_forbidden', async () => {
    const fetcher = vi.fn(async () => [makeVacancy('v-1', 'src-forbidden')]);
    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          id: 'src-forbidden',
          name: 'Disallowed Source',
          type: 'json_api',
          enabled: true,
          targetUrl: 'https://example.com/disallowed',
          refreshIntervalMinutes: 30,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
          addressStatus: 'robots_forbidden',
        },
      ],
      fetcher,
    });

    const outcomes = await engine.syncDue(BASE_TIME);
    expect(outcomes).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('adapts poll interval when source yields 0 new vacancies and snaps back on new items', async () => {
    let itemsToReturn = [makeVacancy('v-1', 'src-adaptive')];
    const fetcher = vi.fn(async () => itemsToReturn);

    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          id: 'src-adaptive',
          name: 'Adaptive Source',
          type: 'json_api',
          enabled: true,
          targetUrl: 'https://example.com/adaptive',
          refreshIntervalMinutes: 30,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
        },
      ],
      fetcher,
    });

    // 1st sync (finds 1 new item)
    await engine.syncDue(BASE_TIME);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Multiple syncs with no new items
    itemsToReturn = [makeVacancy('v-1', 'src-adaptive')]; // same item, no new items
    await engine.syncSource('src-adaptive', undefined, BASE_TIME + 30 * 60_000);
    await engine.syncSource('src-adaptive', undefined, BASE_TIME + 60 * 60_000);

    // Unchanged count is now >= 2, adapted interval is 45 min (1.5x of 30m)
    fetcher.mockClear();

    // After 35 minutes (less than 45 min adapted interval): syncDue must skip!
    const skipped = await engine.syncDue(BASE_TIME + 95 * 60_000);
    expect(skipped).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();

    // After 46 minutes: syncDue polls it!
    const polled = await engine.syncDue(BASE_TIME + 106 * 60_000);
    expect(polled).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('respects Retry-After header in error message and blocks until specified time', async () => {
    let failWithRetryAfter = true;
    const fetcher = vi.fn(async () => {
      if (failWithRetryAfter) {
        throw new Error('Rate limit exceeded. Retry-After: 300');
      }
      return [makeVacancy('v-1', 'src-retry-after')];
    });

    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          id: 'src-retry-after',
          name: 'Retry-After Source',
          type: 'json_api',
          enabled: true,
          targetUrl: 'https://example.com/retry',
          refreshIntervalMinutes: 1,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
        },
      ],
      fetcher,
    });

    await engine.syncDue(BASE_TIME);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 2 minutes later (Retry-After is 300s = 5 minutes): syncDue must skip!
    fetcher.mockClear();
    const skipped = await engine.syncDue(BASE_TIME + 120_000);
    expect(skipped).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();

    // 6 minutes later: Retry-After has expired, syncDue retries
    failWithRetryAfter = false;
    const retried = await engine.syncDue(BASE_TIME + 360_000);
    expect(retried).toHaveLength(1);
    expect(retried[0].status).toBe('healthy');
  });

  it('reports polite schedule in getSourceHealthReport', async () => {
    const engine = new MultiSourceVacancyEngine({
      sources: [
        {
          id: 'src-health-check',
          name: 'Health Check Source',
          type: 'json_api',
          enabled: true,
          targetUrl: 'https://example.com/health',
          refreshIntervalMinutes: 30,
          itemsFoundTotal: 0,
          itemsActiveTotal: 0,
        },
      ],
      fetcher: async () => [makeVacancy('v-1', 'src-health-check')],
    });

    await engine.syncDue(BASE_TIME);
    const report = engine.getSourceHealthReport(BASE_TIME);
    expect(report).toHaveLength(1);
    expect(report[0].schedule).toBeDefined();
    expect(report[0].schedule?.isDue).toBe(false);
    expect(report[0].schedule?.adaptedIntervalMinutes).toBe(30);
    expect(report[0].schedule?.consecutiveFailures).toBe(0);
  });
});
