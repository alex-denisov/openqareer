import { describe, expect, it, vi } from 'vitest';
import { searchHhVacancies } from './hhVacancySearch';

describe('hh vacancy search', () => {
  it('normalizes a public vacancy sample with source and observation time', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
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

  it('fails closed when hh returns an unexpected response', async () => {
    await expect(
      searchHhVacancies(
        { text: 'operations' },
        { fetchImpl: async () => new Response('limited', { status: 429 }) },
      ),
    ).rejects.toThrow('hh_vacancy_search_unavailable');
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

  it('falls back to the public result page when the unauthenticated API is forbidden', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"errors":[{"type":"forbidden"}]}', { status: 403 }))
      .mockResolvedValueOnce(
        new Response(`
          <h1>Найдено 27 вакансий</h1>
          <a data-qa="serp-item__title" href="https://hh.ru/vacancy/456?from=search">
            <span data-qa="serp-item__title-text">Head of Operations</span>
          </a>
          <span data-qa="vacancy-serp__vacancy-employer-text">Synthetic &amp; Co</span>
          <span data-qa="vacancy-serp__vacancy-address">Санкт-Петербург</span>
        `, { status: 200, headers: { 'Content-Type': 'text/html' } }),
      );

    const sample = await searchHhVacancies(
      { text: 'Head of Operations', perPage: 10 },
      { fetchImpl, now: () => '2026-08-07T13:00:00.000Z' },
    );

    expect(sample.found).toBe(27);
    expect(sample.items[0]).toMatchObject({
      id: '456',
      title: 'Head of Operations',
      company: 'Synthetic & Co',
      location: 'Санкт-Петербург',
      publishedAt: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
