import { describe, expect, it } from 'vitest';
import {
  CORPORATE_HTML_ENDPOINTS,
  fetchCorporateHtmlVacancies,
} from './corporateHtmlAdapter';
import { useRecordedFetch } from './__fixtures__/recordedFetch';

describe('Corporate HTML Generic Adapter', () => {
  useRecordedFetch('corporateHtmlAdapter');
  it('registers Kaspersky, Veeam, and FaceApp as declarative endpoints', () => {
    const ids = CORPORATE_HTML_ENDPOINTS.map((e) => e.id);
    expect(ids).toContain('kaspersky');
    expect(ids).toContain('veeam');
    expect(ids).toContain('faceapp');
  });

  it('fetches live FaceApp vacancies via generic HTML adapter', async () => {
    const endpoint = CORPORATE_HTML_ENDPOINTS.find((e) => e.id === 'faceapp')!;
    const vacancies = await fetchCorporateHtmlVacancies(endpoint);

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('FaceApp');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/www\.faceapp\.com\/careers\//);
    expect(first.provenance.sourceId).toBe('src-faceapp');
  });

  it('fetches live Kaspersky vacancies via generic HTML adapter', async () => {
    const endpoint = CORPORATE_HTML_ENDPOINTS.find((e) => e.id === 'kaspersky')!;
    const vacancies = await fetchCorporateHtmlVacancies(endpoint);

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('Kaspersky');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/careers\.kaspersky\.com\/vacancy\//);
    expect(first.provenance.sourceId).toBe('src-kaspersky');
  });

  it('fetches live Veeam vacancies via generic HTML adapter', async () => {
    const endpoint = CORPORATE_HTML_ENDPOINTS.find((e) => e.id === 'veeam')!;
    const vacancies = await fetchCorporateHtmlVacancies(endpoint);

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('Veeam');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/careers\.veeam\.com\/job\//);
    expect(first.provenance.sourceId).toBe('src-veeam');
  });

  it('parses mock HTML card markup cleanly when customFetch is injected', async () => {
    const mockHtml = `
      <div class="vacancies-list">
        <div class="grid grid-cols-1 item">
          <a href="/vacancy/101">Security Operations Analyst</a>
          <span data-testid="vacancy-tag-category-1">Threat Intelligence</span>
          <span data-testid="vacancy-tag-city-1">Moscow</span>
          </svg>
        </div>
      </div>
    `;

    const endpoint = CORPORATE_HTML_ENDPOINTS.find((e) => e.id === 'kaspersky')!;
    const mockFetch = async () =>
      new Response(mockHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });

    const vacancies = await fetchCorporateHtmlVacancies(endpoint, {
      customFetch: mockFetch as unknown as typeof fetch,
    });

    expect(vacancies.length).toBe(1);
    expect(vacancies[0]!.id).toBe('src-kaspersky:101');
    expect(vacancies[0]!.title).toBe('Security Operations Analyst');
    expect(vacancies[0]!.company).toBe('Kaspersky');
    expect(vacancies[0]!.location).toBe('Moscow');
    expect(vacancies[0]!.description).toBe('Security Operations Analyst — Threat Intelligence — Moscow');
    expect(vacancies[0]!.status).toBe('active');
  });
});
