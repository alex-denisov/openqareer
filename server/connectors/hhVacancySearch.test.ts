import { describe, expect, it, vi } from 'vitest';
import { searchHhVacancies } from './hhVacancySearch';

describe('hh vacancy search', () => {
  it('normalizes a public vacancy sample with source and observation time', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            found: 143,
            items: [
              {
                id: '123',
                name: 'Руководитель клиентских операций',
                alternate_url: 'https://hh.ru/vacancy/123',
                published_at: '2026-08-07T10:00:00+0300',
                employer: { name: 'Synthetic Company' },
                area: { name: 'Москва' },
                salary: { from: 250000, to: 320000, currency: 'RUR', gross: true },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );

    const sample = await searchHhVacancies(
      { text: 'руководитель операций', perPage: 12 },
      {
        fetchImpl,
        now: () => '2026-08-07T13:00:00.000Z',
      },
    );

    expect(sample).toMatchObject({
      source: 'hh',
      query: 'руководитель операций',
      found: 143,
      fetchedAt: '2026-08-07T13:00:00.000Z',
      items: [
        {
          id: '123',
          title: 'Руководитель клиентских операций',
          company: 'Synthetic Company',
          location: 'Москва',
          sourceUrl: 'https://hh.ru/vacancy/123',
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toContain('per_page=12');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      headers: { 'HH-User-Agent': expect.stringContaining('openqareer') },
    });
  });

  it('fails closed and preserves Retry-After when hh rate limits the search', async () => {
    await expect(
      searchHhVacancies(
        { text: 'operations' },
        {
          fetchImpl: async () =>
            new Response('limited', {
              status: 429,
              headers: { 'Retry-After': '120' },
            }),
          now: () => '2026-08-13T12:00:00.000Z',
        },
      ),
    ).rejects.toMatchObject({
      message: 'hh_vacancy_search_rate_limited',
      retryAfterAt: '2026-08-13T12:02:00.000Z',
    });
  });

  it('fails closed when an upstream response contains a non-hh vacancy URL', async () => {
    await expect(
      searchHhVacancies(
        { text: 'operations' },
        {
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                found: 1,
                items: [
                  {
                    id: '123',
                    name: 'Operations lead',
                    alternate_url: 'https://example.invalid/vacancy/123',
                    published_at: '2026-08-08T10:00:00+0300',
                    employer: { name: 'Synthetic Company' },
                    area: { name: 'Москва' },
                    salary: null,
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
        },
      ),
    ).rejects.toThrow('hh_vacancy_search_invalid');
  });

  it('fails closed when hh.ru forbids the unauthenticated search', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('{"errors":[{"type":"forbidden"}]}', { status: 403 }),
    );

    await expect(
      searchHhVacancies({ text: 'Head of Operations', perPage: 10 }, { fetchImpl }),
    ).rejects.toThrow('hh_vacancy_search_official_access_required');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('never reaches for the public result page behind the closed API (INC-022)', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('{"errors":[{"type":"forbidden"}]}', { status: 403 }),
    );

    await expect(
      searchHhVacancies({ text: 'qa' }, { fetchImpl }),
    ).rejects.toThrow('hh_vacancy_search_official_access_required');
    const requested = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(requested.some((url) => url.includes('hh.ru/search/vacancy'))).toBe(false);
  });
});
