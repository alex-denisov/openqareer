import { describe, expect, it, vi } from 'vitest';
import {
  createRemotiveSourceCache,
  searchRemotiveVacancies,
} from './remotiveVacancySearch';

describe('Remotive vacancy search', () => {
  it('returns a bounded normalized sample without retaining descriptions', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          'job-count': 1,
          jobs: [
            {
              id: 101,
              url: 'https://remotive.com/remote-jobs/product/senior-product-manager-101',
              title: 'Senior Product Manager',
              company_name: 'Synthetic Company',
              category: 'Product',
              job_type: 'full_time',
              publication_date: '2026-08-12T06:40:00',
              candidate_required_location: 'Europe',
              salary: '$100,000 - $120,000',
              description: '<p>Contact recruiter@example.test</p>',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      searchRemotiveVacancies(
        { text: 'product manager', perPage: 5 },
        {
          fetchImpl,
          now: () => '2026-08-13T12:00:00.000Z',
        },
      ),
    ).resolves.toEqual({
      source: 'remotive',
      query: 'product manager',
      found: 1,
      fetchedAt: '2026-08-13T12:00:00.000Z',
      items: [
        {
          id: '101',
          title: 'Senior Product Manager',
          company: 'Synthetic Company',
          location: 'Europe',
          sourceUrl: 'https://remotive.com/remote-jobs/product/senior-product-manager-101',
          publishedAt: '2026-08-12T06:40:00.000Z',
          salary: null,
          workMode: 'remote',
          requirements: ['Product', 'full_time'],
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://remotive.com/api/remote-jobs?limit=50',
      expect.any(Object),
    );
  });

  it('shares one source snapshot across candidate queries for six hours', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          'job-count': 2,
          jobs: [
            {
              id: 101,
              url: 'https://remotive.com/remote-jobs/product/product-manager-101',
              title: 'Product Manager',
              company_name: 'Synthetic Product',
              category: 'Product',
              job_type: 'full_time',
              publication_date: '2026-08-12T06:40:00Z',
              candidate_required_location: 'Europe',
            },
            {
              id: 102,
              url: 'https://remotive.com/remote-jobs/software/data-engineer-102',
              title: 'Data Engineer',
              company_name: 'Synthetic Data',
              category: 'Software Development',
              job_type: 'full_time',
              publication_date: '2026-08-12T07:40:00Z',
              candidate_required_location: 'Worldwide',
            },
          ],
        }),
      ),
    );
    const cache = createRemotiveSourceCache();

    const product = await searchRemotiveVacancies(
      { text: 'product manager' },
      { fetchImpl, cache, now: () => '2026-08-13T12:00:00.000Z' },
    );
    const engineer = await searchRemotiveVacancies(
      { text: 'data engineer' },
      { fetchImpl, cache, now: () => '2026-08-13T13:00:00.000Z' },
    );

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(product.items).toHaveLength(1);
    expect(engineer.items).toHaveLength(1);
    expect(engineer.fetchedAt).toBe('2026-08-13T12:00:00.000Z');
  });

  it('preserves Retry-After without retrying in a tight loop', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('limited', {
        status: 429,
        headers: { 'Retry-After': '120' },
      }),
    );

    await expect(
      searchRemotiveVacancies(
        { text: 'product manager' },
        {
          fetchImpl,
          now: () => '2026-08-13T12:00:00.000Z',
        },
      ),
    ).rejects.toMatchObject({
      message: 'remotive_vacancy_search_rate_limited',
      retryAfterAt: '2026-08-13T12:02:00.000Z',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects an oversized upstream payload', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          'job-count': 0,
          jobs: [],
          padding: 'x'.repeat(1_050_000),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      searchRemotiveVacancies(
        { text: 'product manager' },
        { fetchImpl },
      ),
    ).rejects.toThrow('vacancy_source_response_too_large');
  });
});

describe('Remotive relevance (B161)', () => {
  const corpus = () =>
    new Response(
      JSON.stringify({
        'job-count': 3,
        jobs: [
          {
            id: 201,
            url: 'https://remotive.com/remote-jobs/product/group-product-lead-201',
            title: 'Group Product Lead',
            company_name: 'Synthetic Remote Co',
            category: 'Product',
            job_type: 'full_time',
            publication_date: '2026-08-20T06:40:00Z',
            candidate_required_location: 'Worldwide',
          },
          {
            id: 202,
            url: 'https://remotive.com/remote-jobs/software/golang-engineer-202',
            title: 'Senior Golang Engineer',
            company_name: 'Synthetic Backend',
            category: 'Software Development',
            job_type: 'full_time',
            publication_date: '2026-08-20T07:40:00Z',
            candidate_required_location: 'Europe',
          },
          {
            id: 203,
            url: 'https://remotive.com/remote-jobs/product/product-manager-203',
            title: 'Product Manager, Payments',
            company_name: 'Synthetic Fintech',
            category: 'Product',
            job_type: 'full_time',
            publication_date: '2026-08-20T08:40:00Z',
            candidate_required_location: 'Worldwide',
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  /**
   * Requiring every search term to appear verbatim returned nothing for an
   * ordinary two-word search, so the honest source looked empty while the
   * fabricated one looked full (B161). Relevance is ranked, not gated.
   */
  it('returns partially matching roles ranked ahead of unrelated ones', async () => {
    const sample = await searchRemotiveVacancies(
      { text: 'product manager', perPage: 5 },
      {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(corpus()),
        now: () => '2026-08-24T12:00:00.000Z',
        cache: createRemotiveSourceCache(),
      },
    );

    expect(sample.found).toBeGreaterThan(0);
    expect(sample.items[0]?.title).toBe('Product Manager, Payments');
    expect(sample.items.map((item) => item.title)).toContain('Group Product Lead');
  });

  it('excludes a posting that shares no term with the query', async () => {
    const sample = await searchRemotiveVacancies(
      { text: 'product manager', perPage: 5 },
      {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(corpus()),
        now: () => '2026-08-24T12:00:00.000Z',
        cache: createRemotiveSourceCache(),
      },
    );

    expect(sample.items.map((item) => item.title)).not.toContain(
      'Senior Golang Engineer',
    );
  });
});

describe('Remotive query with no usable terms (B161)', () => {
  it('claims nothing when the query carries no term longer than one character', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          'job-count': 1,
          jobs: [
            {
              id: 301,
              url: 'https://remotive.com/remote-jobs/software/backend-engineer-301',
              title: 'Backend Engineer',
              company_name: 'Synthetic Backend',
              category: 'Software Development',
              job_type: 'full_time',
              publication_date: '2026-08-20T07:40:00Z',
              candidate_required_location: 'Europe',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const sample = await searchRemotiveVacancies(
      { text: 'R&D', perPage: 5 },
      {
        fetchImpl,
        now: () => '2026-08-24T12:00:00.000Z',
        cache: createRemotiveSourceCache(),
      },
    );

    expect(sample.items).toEqual([]);
    expect(sample.found).toBe(0);
  });
});
