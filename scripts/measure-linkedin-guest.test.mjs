import { describe, expect, it } from 'vitest';
import {
  buildGuestPageUrl,
  measureGuestQueries,
  parseGuestJobIds,
  parseMeasureArgs,
} from './measure-linkedin-guest.mjs';

const QUERY_DUBAI = {
  number: 1,
  role: 'VP Technology & Operations',
  location: 'Dubai, United Arab Emirates',
  remote: false,
};

function htmlResponse(status, body = '') {
  return {
    status,
    headers: new Headers({ 'content-type': 'text/html; charset=UTF-8' }),
    text: async () => body,
  };
}

describe('LinkedIn guest measurement', () => {
  it('counts posting IDs from HTML without retaining duplicate suppression', () => {
    const html = [
      '<li data-entity-urn="urn:li:jobPosting:401">',
      '<li data-entity-urn="urn:li:jobPosting:401">',
      "<li data-entity-urn='urn:li:jobPosting:402'>",
      '<li data-entity-urn="urn:li:jobPosting:sponsored">',
    ].join('');

    expect(parseGuestJobIds(html)).toEqual(['401', '401', '402']);
  });

  it('builds a fixed LinkedIn guest URL with encoded role, location, offset, and remote filter', () => {
    const url = new URL(
      buildGuestPageUrl({ ...QUERY_DUBAI, location: 'Worldwide', remote: true }, 550),
    );

    expect(url.origin).toBe('https://www.linkedin.com');
    expect(url.pathname).toBe('/jobs-guest/jobs/api/seeMoreJobPostings/search');
    expect(url.searchParams.get('keywords')).toBe('VP Technology & Operations');
    expect(url.searchParams.get('location')).toBe('Worldwide');
    expect(url.searchParams.get('f_TPR')).toBe('r604800');
    expect(url.searchParams.get('f_WT')).toBe('2');
    expect(url.searchParams.get('start')).toBe('550');
  });

  it('counts duplicates across pages and moves to the next query after an empty page', async () => {
    const calls = [];
    const sleeps = [];
    const result = await measureGuestQueries({
      queries: [QUERY_DUBAI, { ...QUERY_DUBAI, number: 2, remote: true }],
      fetchPage: async (url) => {
        calls.push(new URL(url));
        if (calls.length === 1)
          return htmlResponse(
            200,
            '<li data-entity-urn="urn:li:jobPosting:401"><li data-entity-urn="urn:li:jobPosting:401"><li data-entity-urn="urn:li:jobPosting:402">',
          );
        return htmlResponse(200, '');
      },
      sleep: async (milliseconds) => sleeps.push(milliseconds),
      now: (() => {
        let time = 0;
        return () => time++ * 10;
      })(),
      random: () => 0.9,
    });

    expect(result.requestCount).toBe(3);
    expect(result.stopReason).toBeNull();
    expect(calls.map((url) => url.searchParams.get('start'))).toEqual(['0', '10', '0']);
    expect(calls[2].searchParams.get('f_WT')).toBe('2');
    expect(sleeps).toEqual([5900, 5900]);
    expect(result.queries[0]).toMatchObject({
      returnedCount: 3,
      uniqueCount: 2,
      duplicateCount: 1,
      duplicateRatePct: 33.33,
      stopReason: 'empty_page',
    });
    expect(result.queries[1]).toMatchObject({
      number: 2,
      returnedCount: 0,
      stopReason: 'empty_page',
    });
  });

  it.each([429, 999])('stops all queries on HTTP %s without retrying', async (status) => {
    const calls = [];
    const result = await measureGuestQueries({
      queries: [QUERY_DUBAI, { ...QUERY_DUBAI, number: 2 }],
      fetchPage: async (url) => {
        calls.push(url);
        return htmlResponse(status);
      },
      sleep: async () => {},
      random: () => 0,
    });

    expect(calls).toHaveLength(1);
    expect(result.requestCount).toBe(1);
    expect(result.stopReason).toBe(`http_${status}`);
    expect(result.queries[0].stopReason).toBe(`http_${status}`);
    expect(result.queries[1]).toMatchObject({ status: 'skipped' });
  });

  it('requires an explicit live-run flag and output path before making requests', () => {
    expect(parseMeasureArgs([])).toEqual({ runLive: false, outputPath: null });
    expect(() => parseMeasureArgs(['--run-live'])).toThrow(/--output/);
    expect(parseMeasureArgs(['--run-live', '--output', '/tmp/b256.json'])).toEqual({
      runLive: true,
      outputPath: '/tmp/b256.json',
    });
  });
});
