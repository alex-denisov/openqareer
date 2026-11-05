import { describe, expect, it } from 'vitest';
import {
  NEXT_DATA_CAREER_ENDPOINTS,
  fetchNextDataVacancies,
} from './nextDataCareerAdapter';

describe('Next.js SSR Data Generic Career Adapter', () => {
  it('registers Preply as a declarative endpoint', () => {
    const ids = NEXT_DATA_CAREER_ENDPOINTS.map((e) => e.id);
    expect(ids).toContain('preply');
  });

  it('fetches live Preply vacancies via Next.js hydration payload', async () => {
    const preplyEndpoint = NEXT_DATA_CAREER_ENDPOINTS.find((e) => e.id === 'preply')!;
    const vacancies = await fetchNextDataVacancies(preplyEndpoint);

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('Preply');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/preply\.com\/en\/careers\/apply\?ashby_jid=/);
    expect(first.provenance.sourceId).toBe('src-preply');
  });

  it('parses mock Next.js pageProps cleanly when customFetch is injected', async () => {
    const mockNextHtml = `
      <!DOCTYPE html>
      <html>
        <head></head>
        <body>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "jobs": [
                    {
                      "id": "job-789",
                      "title": "Staff Platform Engineer",
                      "department": "Infrastructure",
                      "location": "Barcelona, Spain",
                      "publishedAt": "2026-11-01T12:00:00Z"
                    }
                  ]
                }
              }
            }
          </script>
        </body>
      </html>
    `;

    const mockEndpoint = NEXT_DATA_CAREER_ENDPOINTS.find((e) => e.id === 'preply')!;
    const mockFetch = async () =>
      new Response(mockNextHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });

    const vacancies = await fetchNextDataVacancies(mockEndpoint, {
      customFetch: mockFetch as unknown as typeof fetch,
    });

    expect(vacancies.length).toBe(1);
    expect(vacancies[0]!.id).toBe('src-preply:job-789');
    expect(vacancies[0]!.title).toBe('Staff Platform Engineer');
    expect(vacancies[0]!.company).toBe('Preply');
    expect(vacancies[0]!.location).toBe('Barcelona, Spain');
    expect(vacancies[0]!.status).toBe('active');
  });
});
