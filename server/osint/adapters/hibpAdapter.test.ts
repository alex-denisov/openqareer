import { describe, expect, it, vi } from 'vitest';
import { FootprintSourceError } from './footprintAdapter';
import { createHibpAdapter } from './hibpAdapter';
import { FootprintRequestGate } from './requestScheduler';

describe('HIBP email adapter', () => {
  it('uses the email hash-range endpoint and retains only the exact matching suffix', async () => {
    const fetchFixture = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            hashSuffix: 'C6C0AADE0C085843D66E4944E108C4A4CD',
            websites: ['Adobe', 'Gawker'],
          },
          {
            hashSuffix: '0000000000000000000000000000000000',
            websites: ['Unrelated account'],
          },
        ]),
        { status: 200 },
      ),
    );
    const adapter = createHibpAdapter({
      apiKey: 'fixture-key',
      fetch: fetchFixture,
      now: () => new Date('2026-10-04T12:00:00.000Z'),
      requestGate: new FootprintRequestGate({ wait: async () => undefined, now: () => 1_000 }),
    });

    const findings = await adapter.run(
      { email: 'MULTIPLE-BREACHES@HIBP-INTEGRATION-TESTS.COM' },
      new AbortController().signal,
    );

    expect(findings.map((finding) => finding.title)).toEqual(['Adobe', 'Gawker']);
    expect(findings[0]).toMatchObject({
      adapter: 'hibp',
      kind: 'breach',
      url: null,
      match: 'likely_self',
      observedAt: '2026-10-04T12:00:00.000Z',
      receipt: {
        method: 'GET',
        source: 'Have I Been Pwned',
        query: 'sha1-prefix=6B5917',
      },
    });
    expect(JSON.stringify(findings)).not.toContain('multiple-breaches@hibp-integration-tests.com');
    expect(JSON.stringify(findings)).not.toContain('Unrelated account');
    expect(fetchFixture).toHaveBeenCalledWith(
      'https://haveibeenpwned.com/api/v3/breachedaccount/range/6B5917',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'hibp-api-key': 'fixture-key' }),
      }),
    );
  });

  it('reports a missing API key as not connected without making a request', async () => {
    const fetchFixture = vi.fn();
    const adapter = createHibpAdapter({ fetch: fetchFixture });

    await expect(
      adapter.run({ email: 'candidate@example.test' }, new AbortController().signal),
    ).rejects.toMatchObject({ failure: 'not_connected' });
    expect(fetchFixture).not.toHaveBeenCalled();
  });

  it('reports malformed matching breach data as a source error', async () => {
    const fetchFixture = vi.fn(async () =>
      new Response(JSON.stringify([
        {
          hashSuffix: 'C6C0AADE0C085843D66E4944E108C4A4CD',
          websites: 'not-an-array',
        },
      ]), { status: 200 }),
    );
    const adapter = createHibpAdapter({
      apiKey: 'fixture-key',
      fetch: fetchFixture,
      requestGate: new FootprintRequestGate({ wait: async () => undefined }),
    });

    await expect(
      adapter.run(
        { email: 'multiple-breaches@hibp-integration-tests.com' },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(FootprintSourceError);
  });

  it('reports null range entries as a typed source error', async () => {
    const fetchFixture = vi.fn(async () => new Response('[null]', { status: 200 }));
    const adapter = createHibpAdapter({
      apiKey: 'fixture-key',
      fetch: fetchFixture,
      requestGate: new FootprintRequestGate({ wait: async () => undefined }),
    });

    await expect(
      adapter.run({ email: 'candidate@example.test' }, new AbortController().signal),
    ).rejects.toBeInstanceOf(FootprintSourceError);
  });
});
