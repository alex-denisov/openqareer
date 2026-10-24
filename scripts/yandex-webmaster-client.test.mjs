import { describe, expect, it, vi } from 'vitest';
import { collectYandexWebmaster } from './yandex-webmaster-client.mjs';

function fixture(failSummary = false) {
  return vi.fn(async input => {
    const path = new URL(input).pathname;
    if (path === '/v4/user') return Response.json({ user_id: 1 });
    if (path.endsWith('/hosts')) return Response.json({ hosts: [
      { ascii_host_url: 'https://notopenqareer.com/', host_id: 'wrong', verified: true },
      { ascii_host_url: 'https://openqareer.com/', host_id: 'correct', verified: true },
    ] });
    if (path.endsWith('/summary')) return failSummary
      ? Response.json({ error_code: 'HOST_NOT_LOADED', error_message: 'private provider text' }, { status: 404 })
      : Response.json({ sqi: 0, searchable_pages_count: 12 });
    if (path.endsWith('/popular')) return Response.json({ queries: [{ query_text: 'работа', query_id: 'not-public', indicators: {TOTAL_SHOWS:4,TOTAL_CLICKS:1,AVG_SHOW_POSITION:2} }], date_from:'2026-10-10', date_to:'2026-10-16' });
    if (path.endsWith('/quota')) return Response.json({ daily_quota:10, quota_remainder:9 });
    if (path.endsWith('/sitemaps')) return Response.json({ sitemaps: [{sitemap_url:'https://openqareer.com/sitemap.xml'}] });
    throw new Error('unexpected request');
  });
}

describe('bounded Yandex Webmaster observations', () => {
  it('selects the exact verified property and preserves dated source metrics', async () => {
    const fetcher=fixture();
    const data=await collectYandexWebmaster('fixture-token',{fetcher});
    expect(data.summary).toMatchObject({status:'available',sqi:0,indexedPages:12});
    expect(data.queries.rows[0]).toMatchObject({query:'работа',clicks:1,impressions:4,ctr:0.25,position:2});
    expect(data.queries).toMatchObject({dateFrom:'2026-10-10',dateTo:'2026-10-16'});
    expect(data.quota).toMatchObject({daily:10,remaining:9});
    expect(fetcher.mock.calls.some(([url])=>url.includes('/wrong/'))).toBe(false);
    expect(fetcher.mock.calls.every(([,options])=>options.method==='GET')).toBe(true);
    expect(JSON.stringify(data)).not.toContain('fixture-token');
    expect(JSON.stringify(data)).not.toContain('not-public');
  });
  it('keeps an unavailable summary distinct from zero and preserves other available sources', async () => {
    const data=await collectYandexWebmaster('fixture-token',{fetcher:fixture(true)});
    expect(data.summary).toEqual({status:'unavailable',reason:'HOST_NOT_LOADED'});
    expect(data.queries.status).toBe('available');
    expect(JSON.stringify(data)).not.toContain('private provider text');
  });
});
