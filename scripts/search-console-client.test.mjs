import { describe, expect, it, vi } from 'vitest';
import { querySearchAnalytics, searchAnalyticsWindow, searchAnalyticsTotals, exchangeSearchConsoleToken } from './search-console-client.mjs';

describe('Search Console dated observations', () => {
  it('requests exactly 28 completed calendar days in the API Pacific timezone', () => {
    expect(searchAnalyticsWindow(new Date('2026-10-23T00:30:00Z'))).toEqual({
      startDate: '2026-09-24', endDate: '2026-10-21',
    });
  });
  it('keeps aggregate analytics separate from the top 50 query dimensions', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ rows: [] })));
    await querySearchAnalytics('fixture-token', 'https://openqareer.com/', { fetcher });
    await querySearchAnalytics('fixture-token', 'https://openqareer.com/', { fetcher, byQuery: true });
    const aggregate = JSON.parse(fetcher.mock.calls[0][1].body);
    const queries = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    expect(aggregate.rowLimit).toBe(1);
    expect(aggregate.dimensions).toBeUndefined();
    expect(queries.rowLimit).toBe(50);
    expect(queries.dimensions).toEqual(['query']);
    expect(queries.dataState).toBe('final');
    expect(fetcher.mock.calls[1][0]).toContain(encodeURIComponent('https://openqareer.com/'));
  });
  it('does not expose credentials or provider error bodies when access is refused', async () => {
    const fetcher = vi.fn(async () => new Response('private provider content', { status: 403 }));
    await expect(querySearchAnalytics('fixture-token', 'https://openqareer.com/', { fetcher }))
      .rejects.toThrow('Search Console SearchAnalytics API HTTP 403');
  });
});

it('preserves absent source metrics as unknown while retaining measured zero clicks', () => {
  expect(searchAnalyticsTotals({ rows: [] })).toEqual({clicks:null, impressions:null, ctr:null, position:null});
  expect(searchAnalyticsTotals({rows:[{clicks:0,impressions:4,ctr:0,position:2.8}]})).toEqual({clicks:0,impressions:4,ctr:0,position:2.8});
});

it('redacts OAuth provider errors instead of echoing an assertion or private response', async () => {
  const fetcher=vi.fn(async()=>new Response('fixture-private-assertion',{status:400}));
  await expect(exchangeSearchConsoleToken('fixture-private-assertion',{fetcher})).rejects.toThrow('Google OAuth2 HTTP 400');
});

it('redacts successful HTTP responses that contain malformed provider JSON', async () => {
  const fetcher=vi.fn(async()=>new Response('fixture-private-body',{status:200}));
  await expect(exchangeSearchConsoleToken('fixture-token',{fetcher})).rejects.toThrow('Search Console invalid JSON response');
  await expect(querySearchAnalytics('fixture-token','https://openqareer.com/',{fetcher})).rejects.toThrow('Search Console invalid JSON response');
});
