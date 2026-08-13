import { describe, expect, it, vi } from 'vitest';
import { searchArbeitnowVacancies } from './arbeitnowVacancySearch';

describe('Arbeitnow vacancy search', () => {
  it('returns a bounded normalized sample from the public API', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              slug: 'senior-product-manager-berlin-101',
              company_name: 'Synthetic GmbH',
              title: 'Senior Product Manager',
              description: '<p>Contact recruiter@example.test</p>',
              remote: true,
              url: 'https://jobs.example.test/product-101',
              tags: ['Product', 'SaaS'],
              job_types: ['Full-time'],
              location: 'Berlin',
              created_at: 1_786_516_800,
            },
            {
              slug: 'finance-manager-munich-102',
              company_name: 'Example AG',
              title: 'Finance Manager',
              description: '<p>Finance role</p>',
              remote: false,
              url: 'https://jobs.example.test/finance-102',
              tags: ['Finance'],
              job_types: ['Full-time'],
              location: 'Munich',
              created_at: 1_786_516_700,
            },
          ],
          links: { next: null },
          meta: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      searchArbeitnowVacancies(
        { text: 'product manager', perPage: 5 },
        {
          fetchImpl,
          now: () => '2026-08-13T12:00:00.000Z',
          maxPages: 1,
        },
      ),
    ).resolves.toEqual({
      source: 'arbeitnow',
      query: 'product manager',
      found: 1,
      fetchedAt: '2026-08-13T12:00:00.000Z',
      items: [
        {
          id: 'senior-product-manager-berlin-101',
          title: 'Senior Product Manager',
          company: 'Synthetic GmbH',
          location: 'Berlin',
          sourceUrl: 'https://jobs.example.test/product-101',
          publishedAt: '2026-08-12T06:40:00.000Z',
          salary: null,
          workMode: 'remote',
          requirements: ['Product', 'SaaS'],
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves Retry-After without retrying the source in a tight loop', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('limited', {
        status: 429,
        headers: { 'Retry-After': '120' },
      }),
    );

    await expect(
      searchArbeitnowVacancies(
        { text: 'product manager' },
        {
          fetchImpl,
          now: () => '2026-08-13T12:00:00.000Z',
        },
      ),
    ).rejects.toMatchObject({
      message: 'arbeitnow_vacancy_search_rate_limited',
      retryAfterAt: '2026-08-13T12:02:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects an oversized upstream payload before retaining its content', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [],
          links: { next: null },
          meta: {},
          padding: 'x'.repeat(1_050_000),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      searchArbeitnowVacancies(
        { text: 'product manager' },
        { fetchImpl, maxPages: 1 },
      ),
    ).rejects.toThrow('vacancy_source_response_too_large');
  });
});
