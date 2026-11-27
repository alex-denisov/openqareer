import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLinkedinGuestBudget } from '../../linkedinGuestBudget';
import { holdDuringLinkedinPause } from '../../composeVacancyEngine';
import { fetchRobotsTxt } from '../../multiSourceFetcher';
import { PoliteScheduler, STATUS_429_MIN_BACKOFF_MS } from '../../politeScheduler';
import { describeSourceHealth } from '../../sourceHealthVerdict';
import { createOfflineEngine, makeSource, makeVacancy, cleanupTrackedStores } from './helpers/engineHarness';
import { createMockFetchRouter, restoreMockFetch } from './helpers/mockFetch';

afterEach(() => {
  vi.useRealTimers();
  restoreMockFetch();
  cleanupTrackedStores();
});

describe('E2E-3: Error Diagnostics & Terminal Auto-Pause (7,872 errors pattern, F6)', () => {
  // Tier 1 (Happy-Path)
  it('T1.1 withdrawClosedBoard clears slice after 3 consecutive 404s on ATS board', async () => {
    let should404 = false;
    const src = makeSource({ id: 'ats-greenhouse-closedco', name: 'ClosedCo', type: 'json_api' });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetcher: async () => {
        if (should404) throw new Error('vacancy_source_unreachable: 404');
        return [makeVacancy({ id: 'v1', sourceId: src.id, company: 'ClosedCo' })];
      },
    });
    const t0 = Date.UTC(2026, 10, 20, 0);
    await wrapped.engine.syncSource(src.id, undefined, t0);
    expect(wrapped.pool.countSourceSlice(src.id).total).toBe(1);

    should404 = true;
    await wrapped.engine.syncSource(src.id, undefined, t0 + 1 * 3_600_000);
    await wrapped.engine.syncSource(src.id, undefined, t0 + 2 * 3_600_000);
    const third = await wrapped.engine.syncSource(src.id, undefined, t0 + 3 * 3_600_000);
    expect(third.message).toContain('board_closed');
    expect(wrapped.pool.countSourceSlice(src.id).total).toBe(0);
  });

  it('T1.2 terminal errors (403/410/ENOTFOUND) auto-pause source without flooding subsequent syncDue waves', async () => {
    let calls = 0;
    const src = makeSource({
      id: 'src-company-site-gone-dns',
      name: 'GoneDNS',
      type: 'career_site',
      channelTier: 1,
    });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetcher: async () => {
        calls += 1;
        throw new Error('fetch failed: ENOTFOUND nonexistent.invalid');
      },
    });

    const t0 = Date.UTC(2026, 10, 20, 12);
    await wrapped.engine.syncDue(t0);
    // Repeated syncDue 1 hour later must not re-poll terminal ENOTFOUND error immediately
    await wrapped.engine.syncDue(t0 + 60 * 60_000);
    expect(calls).toBe(1);
    const stored = wrapped.pool.loadSourceStates().find((s) => s.sourceId === src.id);
    expect(stored?.lastStatus).toBe('error');
  });

  it('T1.3 LinkedIn mid-wave 429 holds sibling src-company-li-* sources via holdDuringLinkedinPause', async () => {
    let nowMs = Date.UTC(2026, 10, 20, 12);
    const budget = createLinkedinGuestBudget({ now: () => nowMs, sleep: async () => undefined });
    const holdSource = holdDuringLinkedinPause(budget);
    const s1 = makeSource({
      id: 'src-company-li-alpha',
      name: 'Alpha (LinkedIn)',
      type: 'json_api',
      channelTier: 1,
      linkedinOrgId: '10001',
    });
    const s2 = makeSource({
      id: 'src-company-li-beta',
      name: 'Beta (LinkedIn)',
      type: 'json_api',
      channelTier: 1,
      linkedinOrgId: '10002',
    });
    let callsBeta = 0;
    const wrapped = createOfflineEngine({
      sources: [s1, s2],
      holdSource,
      fetcher: async (src) => {
        if (src.id === s1.id) {
          budget.markRateLimited();
          throw new Error('vacancy_source_unreachable: 429');
        }
        callsBeta += 1;
        return [];
      },
    });

    await wrapped.engine.syncSource(s1.id, undefined, nowMs);
    expect(budget.isPaused()).toBe(true);
    expect(holdSource(s2)).toBe(true);
    await wrapped.engine.syncDue(nowMs + 5_000);
    expect(callsBeta).toBe(0);
    nowMs += 31 * 60_000;
    expect(holdSource(s2)).toBe(false);
  });

  it('T1.4 fetchRobotsTxt completes cleanly on 200 and handles aborted requests without throwing', async () => {
    createMockFetchRouter([
      { match: '/robots.txt', respond: { status: 200, body: 'User-agent: *\nDisallow: /private/\n' } },
    ]).install();
    const ok = await fetchRobotsTxt('https://acme.example/robots.txt');
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('Disallow: /private/');
  });

  it('T1.5 transient 503 with Retry-After pauses via PoliteScheduler and recovers on next due 200 sync', async () => {
    let fail = true;
    const src = makeSource({ id: 'ats-lever-recoverco', name: 'RecoverCo', type: 'json_api', channelTier: 1 });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetcher: async () => {
        if (fail) {
          const err = new Error('vacancy_source_unreachable: 503') as Error & {
            statusCode: number;
            headers: Headers;
          };
          err.statusCode = 503;
          err.headers = new Headers({ 'retry-after': '600' });
          throw err;
        }
        return [makeVacancy({ id: 'rec-1', sourceId: src.id, company: 'RecoverCo' })];
      },
    });
    const t0 = Date.UTC(2026, 10, 20, 12);
    const first = await wrapped.engine.syncDue(t0);
    expect(first[0]?.status).toBe('error');

    fail = false;
    // Before Retry-After (600s) elapses, syncDue skips it
    const skipped = await wrapped.engine.syncDue(t0 + 120_000);
    expect(skipped).toHaveLength(0);

    // After Retry-After elapses, recovers cleanly
    const recovered = await wrapped.engine.syncDue(t0 + 700_000);
    expect(recovered[0]?.status).toBe('healthy');
    expect(recovered[0]?.kept).toBe(1);
  });

  // Tier 2 (Boundary / Corner / Negative)
  it('T2.1 1 or 2 consecutive 404s do not wipe existing vacancy slice', async () => {
    let fail404 = false;
    const src = makeSource({ id: 'ats-ashby-keepco', name: 'KeepCo', type: 'json_api' });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetcher: async () => {
        if (fail404) throw new Error('vacancy_source_unreachable: 404');
        return [makeVacancy({ id: 'k-1', sourceId: src.id, company: 'KeepCo' })];
      },
    });
    const t0 = Date.UTC(2026, 10, 20);
    await wrapped.engine.syncSource(src.id, undefined, t0);
    fail404 = true;
    await wrapped.engine.syncSource(src.id, undefined, t0 + 1_000);
    await wrapped.engine.syncSource(src.id, undefined, t0 + 2_000);
    expect(wrapped.pool.countSourceSlice(src.id).total).toBe(1);
  });

  it('T2.2 transient 429/500 does not increment consecutiveNotFound or wipe slice', async () => {
    let mode: 'ok' | '500' | '404' = 'ok';
    const src = makeSource({ id: 'ats-greenhouse-transient', name: 'TransientCo', type: 'json_api' });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetcher: async () => {
        if (mode === '500') throw new Error('vacancy_source_unreachable: 500');
        if (mode === '404') throw new Error('vacancy_source_unreachable: 404');
        return [makeVacancy({ id: 'tr-1', sourceId: src.id, company: 'TransientCo' })];
      },
    });
    const t0 = Date.UTC(2026, 10, 20);
    await wrapped.engine.syncSource(src.id, undefined, t0);
    mode = '404';
    await wrapped.engine.syncSource(src.id, undefined, t0 + 1_000);
    await wrapped.engine.syncSource(src.id, undefined, t0 + 2_000);
    mode = '500';
    await wrapped.engine.syncSource(src.id, undefined, t0 + 3_000);
    expect(wrapped.pool.countSourceSlice(src.id).total).toBe(1);
  });

  it('T2.3 corrupted Retry-After header falls back to STATUS_429_MIN_BACKOFF_MS without NaN', () => {
    const scheduler = new PoliteScheduler();
    const t0 = Date.UTC(2026, 10, 20, 12);
    scheduler.recordAttempt('ats-join-corrupt', {
      success: false,
      statusCode: 429,
      retryAfterHeader: 'not-a-valid-date-or-number',
      nowMs: t0,
    });
    const info = scheduler.getScheduleInfo('ats-join-corrupt', t0 + 1_000);
    expect(info.isDue).toBe(false);
    expect(Number.isFinite(info.nextAvailableAtMs)).toBe(true);
    expect(info.nextAvailableAtMs).toBeGreaterThanOrEqual(t0 + STATUS_429_MIN_BACKOFF_MS);
  });

  it('T2.4 fetchRobotsTxt body-read hang triggers withRequestTimeout without hanging wave', async () => {
    vi.useFakeTimers();
    const hangingFetch = (async () =>
      ({
        ok: true,
        status: 200,
        text: () => new Promise<string>(() => undefined),
      }) as unknown as Response) as typeof fetch;
    vi.stubGlobal('fetch', hangingFetch);

    const robotsPromise = fetchRobotsTxt('https://hang-robots.example/robots.txt').catch((err: unknown) => ({
      aborted: err instanceof Error,
    }));
    const sentinel = new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 12_000));
    const raced = Promise.race([robotsPromise, sentinel]);
    await vi.advanceTimersByTimeAsync(12_500);
    const result = await raced;
    expect(result).not.toBe('hung');
  });

  it('T2.5 non-ATS sources are not purged by withdrawClosedBoard on 3x 404', async () => {
    let fail = false;
    const src = makeSource({ id: 'src-company-site-nonats', name: 'NonAts', type: 'career_site' });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetcher: async () => {
        if (fail) throw new Error('vacancy_source_unreachable: 404');
        return [
          makeVacancy({
            id: 'na-1',
            sourceId: src.id,
            company: 'NonAts',
            publishedAt: '2026-11-19T00:00:00Z',
          }),
        ];
      },
    });
    const t0 = Date.UTC(2026, 10, 20);
    await wrapped.engine.syncSource(src.id, undefined, t0);
    expect(wrapped.pool.countSourceSlice(src.id).total).toBe(1);
    fail = true;
    await wrapped.engine.syncSource(src.id, undefined, t0 + 1_000);
    await wrapped.engine.syncSource(src.id, undefined, t0 + 2_000);
    const third = await wrapped.engine.syncSource(src.id, undefined, t0 + 3_000);
    expect(third.message ?? '').not.toContain('board_closed');
    expect(wrapped.pool.countSourceSlice(src.id).total).toBe(1);
  });

  it('T2.6 dead source receives weekly recheck (DEAD_SOURCE_RECHECK_MS) and restores on 200', async () => {
    let revive = false;
    const src = makeSource({ id: 'ats-greenhouse-revive', name: 'ReviveCo', type: 'json_api', channelTier: 2 });
    const wrapped = createOfflineEngine({
      sources: [src],
      fetcher: async () => {
        if (!revive) {
          return [
            makeVacancy({
              id: 'old-1',
              sourceId: src.id,
              company: 'ReviveCo',
              publishedAt: '2025-01-01T00:00:00Z',
            }),
          ];
        }
        return [
          makeVacancy({
            id: 'new-1',
            sourceId: src.id,
            company: 'ReviveCo',
            publishedAt: '2026-11-27T00:00:00Z',
          }),
        ];
      },
    });
    const t0 = Date.UTC(2026, 10, 1);
    await wrapped.engine.syncSource(src.id, undefined, t0);
    const deadObs = wrapped.pool.loadSourceStates().find((s) => s.sourceId === src.id)?.observations;
    expect(deadObs).toBeDefined();
    expect(describeSourceHealth(deadObs!, { addressStatus: 'live' }, t0).liveness.verdict).toBe('dead');

    revive = true;
    // 8 days later (>= 7d DEAD_SOURCE_RECHECK_MS), syncDue rechecks dead source and restores it
    const tRecheck = t0 + 8 * 86_400_000;
    const outcomes = await wrapped.engine.syncDue(tRecheck);
    expect(outcomes.some((o) => o.sourceId === src.id && o.status === 'healthy')).toBe(true);
    const aliveObs = wrapped.pool.loadSourceStates().find((s) => s.sourceId === src.id)?.observations;
    expect(describeSourceHealth(aliveObs!, { addressStatus: 'live' }, tRecheck).liveness.verdict).toBe('alive');
  });
});
