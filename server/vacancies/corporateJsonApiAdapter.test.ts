import { describe, expect, it } from 'vitest';
import {
  CORPORATE_JSON_ENDPOINTS,
  fetchCorporateJsonApiVacancies,
} from './corporateJsonApiAdapter';

describe('Corporate JSON API Generic Adapter', () => {
  it('registers EPAM and Playrix as declarative endpoints', () => {
    const ids = CORPORATE_JSON_ENDPOINTS.map((e) => e.id);
    expect(ids).toContain('epam');
    expect(ids).toContain('playrix');
  });

  it('fetches live EPAM vacancies through the generic JSON adapter', async () => {
    const epamEndpoint = CORPORATE_JSON_ENDPOINTS.find((e) => e.id === 'epam')!;
    const vacancies = await fetchCorporateJsonApiVacancies(epamEndpoint, { maxPages: 1 });

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('EPAM');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/careers\.epam\.com\/en\/(vacancy|jobs)\//);
    expect(first.provenance.sourceId).toBe('src-epam');
  });

  it('fetches live Playrix vacancies through the generic JSON adapter', async () => {
    const playrixEndpoint = CORPORATE_JSON_ENDPOINTS.find((e) => e.id === 'playrix')!;
    const vacancies = await fetchCorporateJsonApiVacancies(playrixEndpoint, { maxPages: 1 });

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('Playrix');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/playrix\.com\/job\//);
    expect(first.provenance.sourceId).toBe('src-playrix');
  });

  it('parses mock JSON payload cleanly when customFetch is injected', async () => {
    const mockJson = {
      items: [
        {
          code: '12345',
          headline: 'Lead Architect',
          city: 'Berlin',
          country: 'Germany',
          is_wfh: true,
          summary: 'Architecting scalable cloud microservices.',
        },
      ],
    };

    const mockEndpoint = {
      id: 'mock-corp',
      company: 'MockCorp',
      url: 'https://mock.corp/api/jobs',
      extractItems: (json: Record<string, unknown>) => (json.items as unknown[]) ?? [],
      mapItem: (job: Record<string, unknown>) => ({
        externalId: String(job.code || ''),
        title: String(job.headline || ''),
        url: `https://mock.corp/jobs/${String(job.code || '')}`,
        location: `${String(job.city || '')}, ${String(job.country || '')}`,
        isRemote: Boolean(job.is_wfh),
        description: String(job.summary || ''),
      }),
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(mockJson), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const vacancies = await fetchCorporateJsonApiVacancies(mockEndpoint, {
      customFetch: mockFetch as unknown as typeof fetch,
    });

    expect(vacancies.length).toBe(1);
    expect(vacancies[0]!.id).toBe('src-mock-corp:12345');
    expect(vacancies[0]!.title).toBe('Lead Architect');
    expect(vacancies[0]!.company).toBe('MockCorp');
    expect(vacancies[0]!.location).toBe('Berlin, Germany');
    expect(vacancies[0]!.isRemote).toBe(true);
    expect(vacancies[0]!.description).toBe('Architecting scalable cloud microservices.');
    expect(vacancies[0]!.status).toBe('active');
  });
});
