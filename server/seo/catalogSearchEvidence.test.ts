import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { isIndexableListing, LISTING_RETAIN_DAYS } from './catalogIndexing';
import { listingHistoryKey, readListingHistory } from './catalogListingHistory';
import { refreshCatalogSearchEvidence, type SearchEvidenceLog } from './catalogSearchEvidence';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const DAY = 86_400_000;
const tokens = { token: async () => 'token' };

function memoryLog() {
  const lines: Array<{ level: 'info' | 'error'; message: string; details: object }> = [];
  const log: SearchEvidenceLog = {
    info: (details, message) => lines.push({ level: 'info', message, details }),
    error: (details, message) => lines.push({ level: 'error', message, details }),
  };
  return { lines, log };
}

function answer(rows: ReadonlyArray<{ page: string; impressions: number }>, status = 200) {
  const requests: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      auth: new Headers(init?.headers).get('authorization'),
    });
    return new Response(
      JSON.stringify({ rows: rows.map((r) => ({ keys: [r.page], impressions: r.impressions })) }),
      { status },
    );
  }) as typeof fetch;
  return { fetcher, requests };
}

describe('catalog search evidence', () => {
  it('records listings with impressions, a cursor page counting for its list', async () => {
    const database = new DatabaseSync(':memory:');
    const { fetcher, requests } = answer([
      { page: 'https://openqareer.com/vacancies/dubai/electrical-engineer', impressions: 26 },
      { page: 'https://openqareer.com/vacancies/chicago/page/2?after=abc', impressions: 4 },
      { page: 'https://openqareer.com/vacancies/job/some-card-abc', impressions: 9 },
      { page: 'https://openqareer.com/vacancies', impressions: 9 },
      { page: 'https://openqareer.com/vacancies/quiet', impressions: 0 },
    ]);
    const { log, lines } = memoryLog();

    await refreshCatalogSearchEvidence(database, tokens, log, fetcher, NOW);

    const history = readListingHistory(database);
    expect([...history.keys()].sort()).toEqual([
      listingHistoryKey('chicago'),
      listingHistoryKey('dubai', 'electrical-engineer'),
    ]);
    expect(history.get(listingHistoryKey('chicago'))?.lastImpressionAt).toBe(NOW.toISOString());
    expect(requests[0]?.auth).toBe('Bearer token');
    expect(requests[0]?.url).toContain(encodeURIComponent('https://openqareer.com/'));
    expect(requests[0]?.body).toMatchObject({
      startDate: '2026-10-07',
      endDate: '2026-11-04',
      dimensions: ['page'],
    });
    expect(lines.at(-1)).toMatchObject({
      message: 'catalog-search-evidence-written',
      details: { listings: 2 },
    });
  });

  it('keeps a listing with impressions indexed below its threshold, while it has a vacancy', () => {
    const at = (days: number) => ({
      lastImpressionAt: new Date(NOW.getTime() - days * DAY).toISOString(),
    });
    expect(isIndexableListing(3, true, at(LISTING_RETAIN_DAYS - 1), NOW)).toBe(true);
    expect(isIndexableListing(1, false, at(0), NOW)).toBe(true);
    expect(isIndexableListing(0, true, at(0), NOW)).toBe(false);
    expect(isIndexableListing(3, true, at(LISTING_RETAIN_DAYS + 1), NOW)).toBe(false);
  });

  it('merges evidence with the published history of the same listing', async () => {
    const database = new DatabaseSync(':memory:');
    const { recordListingHistory } = await import('./catalogListingHistory');
    recordListingHistory(database, [{ place: 'dubai', count: 40 }], NOW);
    const { fetcher } = answer([
      { page: 'https://openqareer.com/vacancies/dubai', impressions: 3 },
    ]);

    await refreshCatalogSearchEvidence(database, tokens, memoryLog().log, fetcher, NOW);

    expect(readListingHistory(database).get(listingHistoryKey('dubai'))).toEqual({
      firstQualifiedAt: NOW.toISOString(),
      lastQualifiedAt: NOW.toISOString(),
      lastImpressionAt: NOW.toISOString(),
    });
  });

  it('keeps earlier evidence and logs when Search Console refuses', async () => {
    const database = new DatabaseSync(':memory:');
    const good = answer([{ page: 'https://openqareer.com/vacancies/dubai', impressions: 3 }]);
    await refreshCatalogSearchEvidence(database, tokens, memoryLog().log, good.fetcher, NOW);

    const { log, lines } = memoryLog();
    await refreshCatalogSearchEvidence(database, tokens, log, answer([], 403).fetcher, NOW);

    expect(readListingHistory(database).has(listingHistoryKey('dubai'))).toBe(true);
    expect(lines).toEqual([
      {
        level: 'error',
        message: 'catalog-search-evidence-failed',
        details: { reason: 'http_403' },
      },
    ]);
  });
});
