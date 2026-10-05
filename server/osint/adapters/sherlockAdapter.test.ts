import { describe, expect, it, vi } from 'vitest';
import { FootprintSourceError } from './footprintAdapter';
import { FootprintRequestGate } from './requestScheduler';
import { createSherlockAdapter } from './sherlockAdapter';

const requestGate = () => new FootprintRequestGate({ wait: async () => undefined });

describe('Sherlock presence adapter', () => {
  it('reports a public profile as an unconfirmed lead using one GET fixture', async () => {
    const fetchFixture = vi.fn(async () =>
      new Response('<title>ada-lovelace · GitHub</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const adapter = createSherlockAdapter({
      site: {
        name: 'GitHub',
        url: 'https://github.com/{username}',
        checkType: 'status_code',
      },
      fetch: fetchFixture,
      now: () => new Date('2026-10-04T12:00:00.000Z'),
      requestGate: requestGate(),
    });

    const findings = await adapter.run(
      { username: 'ada-lovelace' },
      new AbortController().signal,
    );

    expect(findings).toEqual([
      expect.objectContaining({
        adapter: 'sherlock',
        kind: 'profile',
        url: 'https://github.com/ada-lovelace',
        title: 'GitHub',
        match: 'likely_self',
        observedAt: '2026-10-04T12:00:00.000Z',
        receipt: {
          method: 'GET',
          source: 'GitHub',
          query: 'username=ada-lovelace',
        },
      }),
    ]);
    expect(fetchFixture).toHaveBeenCalledWith(
      'https://github.com/ada-lovelace',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('reports redirects as source errors instead of claiming that nothing was found', async () => {
    const fetchFixture = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://github.com/login' },
      }),
    );
    const adapter = createSherlockAdapter({
      site: {
        name: 'GitHub',
        url: 'https://github.com/{username}',
        checkType: 'status_code',
      },
      fetch: fetchFixture,
      requestGate: requestGate(),
    });

    await expect(
      adapter.run({ username: 'ada-lovelace' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(FootprintSourceError);
    expect(fetchFixture).toHaveBeenCalledWith(
      'https://github.com/ada-lovelace',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('rejects an unsafe username before requesting a site', async () => {
    const fetchFixture = vi.fn();
    const adapter = createSherlockAdapter({
      site: {
        name: 'GitHub',
        url: 'https://github.com/{username}',
        checkType: 'status_code',
      },
      fetch: fetchFixture,
      requestGate: requestGate(),
    });

    await expect(
      adapter.run({ username: 'alice/path' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(FootprintSourceError);
    expect(fetchFixture).not.toHaveBeenCalled();
  });
});
