import { afterEach, describe, expect, it, vi } from 'vitest';
import { listAdminVacancySources, type AdminVacancySource } from './adminApi';

function source(id: string): AdminVacancySource {
  return {
    id,
    name: id,
    type: 'direct',
    enabled: true,
    targetUrl: `https://example.com/${id}`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

describe('listAdminVacancySources', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('publishes each completed page while retaining the full result', async () => {
    const pages = new Map([
      [0, { items: [source('first')], total: 2, offset: 0, nextOffset: 1 }],
      [1, { items: [source('second')], total: 2, offset: 1, nextOffset: null }],
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const offset = Number(
          new URL(String(input), 'https://openqareer.test').searchParams.get('offset'),
        );
        const page = pages.get(offset);
        if (!page) throw new Error(`unexpected offset ${offset}`);
        return new Response(JSON.stringify({ data: page }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const progress: string[][] = [];
    await expect(
      listAdminVacancySources(undefined, (sources) => {
        progress.push(sources.map((item) => item.id));
      }),
    ).resolves.toEqual([source('first'), source('second')]);

    expect(progress).toEqual([['first'], ['first', 'second']]);
  });
});
