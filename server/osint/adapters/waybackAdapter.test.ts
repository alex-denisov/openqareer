import { describe, expect, it, vi } from 'vitest';
import { FootprintSourceError } from './footprintAdapter';
import { FootprintRequestGate } from './requestScheduler';
import { createWaybackAdapter } from './waybackAdapter';

const requestGate = () => new FootprintRequestGate({ wait: async () => undefined });

describe('Wayback adapter', () => {
  it('queries the fixed CDX endpoint and returns only captures of the requested public URL', async () => {
    const profileUrl = 'https://portfolio.example/profile?view=public';
    const fetchFixture = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify([
          ['timestamp', 'original', 'statuscode'],
          ['20240102112233', profileUrl, '200'],
          ['20240203123344', 'https://other.example/profile', '200'],
        ]),
        { status: 200 },
      ),
    );
    const adapter = createWaybackAdapter({
      fetch: fetchFixture,
      resolveHost: async () => ['93.184.216.34'],
      now: () => new Date('2026-10-04T12:00:00.000Z'),
      requestGate: requestGate(),
    });

    const findings = await adapter.run({ profileUrl }, new AbortController().signal);
    const requestUrl = new URL(String(fetchFixture.mock.calls[0]?.[0]));

    expect(requestUrl.origin).toBe('https://web.archive.org');
    expect(requestUrl.pathname).toBe('/cdx/search/cdx');
    expect(requestUrl.searchParams.get('url')).toBe(profileUrl);
    expect(findings).toEqual([
      expect.objectContaining({
        adapter: 'wayback',
        kind: 'archive',
        url: `https://web.archive.org/web/20240102112233/${profileUrl}`,
        match: 'likely_self',
        observedAt: '2026-10-04T12:00:00.000Z',
      }),
    ]);
  });

  it('rejects private or local targets before contacting the archive', async () => {
    const fetchFixture = vi.fn();
    const adapter = createWaybackAdapter({
      fetch: fetchFixture,
      resolveHost: async () => ['127.0.0.1'],
      requestGate: requestGate(),
    });

    await expect(
      adapter.run({ profileUrl: 'http://portfolio.example/profile' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(FootprintSourceError);
    expect(fetchFixture).not.toHaveBeenCalled();
  });

  it('treats an empty CDX response as a successful search with no captures', async () => {
    const fetchFixture = vi.fn(async () => new Response('[]', { status: 200 }));
    const adapter = createWaybackAdapter({
      fetch: fetchFixture,
      resolveHost: async () => ['93.184.216.34'],
      requestGate: requestGate(),
    });

    await expect(
      adapter.run(
        { profileUrl: 'https://portfolio.example/profile' },
        new AbortController().signal,
      ),
    ).resolves.toEqual([]);
  });

  it('reports malformed CDX rows as a typed source error', async () => {
    const fetchFixture = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify([['timestamp', 'original', 'statuscode'], null]), { status: 200 }),
    );
    const adapter = createWaybackAdapter({
      fetch: fetchFixture,
      resolveHost: async () => ['93.184.216.34'],
      requestGate: requestGate(),
    });

    await expect(
      adapter.run({ profileUrl: 'https://portfolio.example/profile' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(FootprintSourceError);
  });
});
