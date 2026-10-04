import { describe, expect, it, vi } from 'vitest';
import { FootprintSourceError } from './footprintAdapter';
import { FootprintRequestGate } from './requestScheduler';
import { createExaAdapter } from './exaAdapter';

const requestGate = () => new FootprintRequestGate({ wait: async () => undefined });

describe('Exa people and web search adapter', () => {
  it('runs people and employer searches with a combined ten-result cap and short excerpts', async () => {
    const longExcerpt = `Ada Lovelace worked at Analytical Engines. ${'Public evidence '.repeat(40)} mail test@example.test +1 202 555 0198 sk-live-abcdefghijk`;
    const fetchFixture = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        results: Array.from({ length: 6 }, (_, index) => ({
          title: index === 0 ? 'Ada Lovelace profile' : `Unrelated person ${index}`,
          url: `https://people.example/profile-${index}`,
          highlights: [longExcerpt],
        })),
      }), { status: 200 }),
    );
    const adapter = createExaAdapter({
      apiKey: 'fixture-key',
      fetch: fetchFixture,
      now: () => new Date('2026-10-04T12:00:00.000Z'),
      requestGate: requestGate(),
    });

    const findings = await adapter.run({
      fullName: 'Ada Lovelace',
      employers: ['Analytical Engines'],
      city: 'London',
      profileUrls: ['https://github.com/ada'],
    }, new AbortController().signal);

    expect(fetchFixture).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchFixture.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(fetchFixture.mock.calls[1]?.[1]?.body));
    expect(firstBody).toMatchObject({ category: 'people', numResults: 5, contents: { highlights: true } });
    expect(secondBody).toMatchObject({ numResults: 5, contents: { highlights: true } });
    expect(secondBody.category).toBeUndefined();
    expect(secondBody.query).toContain('Ada Lovelace');
    expect(secondBody.query).toContain('Analytical Engines');
    expect(findings).toHaveLength(10);
    expect(findings[0]?.match).toBe('likely_self');
    expect(findings[5]?.match).toBe('likely_self');
    expect(findings[6]?.match).toBe('unknown');
    expect(findings.every((finding) => finding.detail.length <= 300)).toBe(true);
    expect(findings.some((finding) => finding.detail.includes('test@example.test'))).toBe(false);
    expect(findings.some((finding) => finding.detail.includes('202 555 0198'))).toBe(false);
    expect(findings.some((finding) => finding.detail.includes('sk-live-abcdefghijk'))).toBe(false);
  });

  it('matches a selected profile URL locally without sending the URL to Exa', async () => {
    const profileUrl = 'https://github.com/ada-lovelace';
    const fetchFixture = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ results: [{ title: 'Public profile', url: profileUrl }] }), { status: 200 }),
    );
    const adapter = createExaAdapter({
      apiKey: 'fixture-key',
      fetch: fetchFixture,
      requestGate: requestGate(),
    });

    const findings = await adapter.run({
      fullName: 'Ada Lovelace', profileUrls: [profileUrl], searchPeople: true, searchContext: false,
    }, new AbortController().signal);

    const requestBody = JSON.parse(String(fetchFixture.mock.calls[0]?.[1]?.body)) as { query: string };
    expect(findings[0]?.match).toBe('likely_self');
    expect(requestBody.query).toBe('Ada Lovelace');
    expect(JSON.stringify(requestBody)).not.toContain(profileUrl);
  });

  it('reports null search results as a typed source error', async () => {
    const fetchFixture = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response('{"results":[null]}', { status: 200 }),
    );
    const adapter = createExaAdapter({
      apiKey: 'fixture-key',
      fetch: fetchFixture,
      requestGate: requestGate(),
    });

    await expect(
      adapter.run({ fullName: 'Ada Lovelace', searchContext: false }, new AbortController().signal),
    ).rejects.toBeInstanceOf(FootprintSourceError);
  });

  it('matches a candidate photo URL locally without sending it to Exa', async () => {
    const photoUrl = 'https://images.example/ada.jpg';
    const fetchFixture = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ results: [
        { title: 'Unrelated profile title', url: 'https://people.example/profile', image: photoUrl },
        { title: 'Unrelated profile title', url: 'https://people.example/other', image: 'https://images.example/other.jpg' },
      ] }), { status: 200 }),
    );
    const adapter = createExaAdapter({
      apiKey: 'fixture-key',
      fetch: fetchFixture,
      requestGate: requestGate(),
    });

    const findings = await adapter.run({
      fullName: 'Ada Lovelace', photoUrl, searchPeople: true, searchContext: false,
    }, new AbortController().signal);
    const requestBody = JSON.parse(String(fetchFixture.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;

    expect(findings.map((finding) => finding.match)).toEqual(['likely_self', 'unknown']);
    expect(JSON.stringify(requestBody)).not.toContain(photoUrl);
  });

  it('reports a missing key as not connected without calling Exa', async () => {
    const fetchFixture = vi.fn();
    const adapter = createExaAdapter({ fetch: fetchFixture });

    await expect(
      adapter.run({ fullName: 'Ada Lovelace' }, new AbortController().signal),
    ).rejects.toMatchObject({ failure: 'not_connected' });
    expect(fetchFixture).not.toHaveBeenCalled();
  });
});
