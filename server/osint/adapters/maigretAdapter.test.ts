import { describe, expect, it, vi } from 'vitest';
import { MAIGRET_SITES } from './maigretSiteCatalogue';
import { FootprintRequestGate } from './requestScheduler';
import { createMaigretAdapter } from './maigretAdapter';

describe('Maigret presence adapter', () => {
  it('uses the shared GET implementation under the maigret adapter id', async () => {
    const site = MAIGRET_SITES.find(
      (candidate) => candidate.adapterId === 'maigret' && candidate.checkType === 'status_code',
    );
    expect(site).toBeDefined();
    const fetchFixture = vi.fn(async () => new Response('', { status: 200 }));
    const adapter = createMaigretAdapter({
      site: site!,
      fetch: fetchFixture,
      requestGate: new FootprintRequestGate({ wait: async () => undefined }),
    });

    const findings = await adapter.run(
      { username: 'candidate-handle' },
      new AbortController().signal,
    );

    expect(adapter.id).toBe('maigret');
    expect(findings[0]).toMatchObject({
      adapter: 'maigret',
      match: 'likely_self',
      receipt: { method: 'GET', source: site?.name },
    });
  });

  it('keeps the curated public site list within the package limit', () => {
    expect(MAIGRET_SITES.length).toBeLessThanOrEqual(150);
    expect(MAIGRET_SITES.some((site) => site.name === 'GitHub')).toBe(true);
    expect(MAIGRET_SITES.some((site) => site.name === 'LinkedIn')).toBe(false);
    expect(MAIGRET_SITES.every((site) => site.url.startsWith('https://'))).toBe(true);
  });
});
