import { describe, expect, it } from 'vitest';
import {
  fetchLinkedinCompanyVacancies,
  LINKEDIN_GROUP_B_TARGETS,
} from './linkedinCompanyGuestAdapter';

describe('LinkedIn Company Guest Adapter (Group B)', () => {
  it('registers all active LinkedIn Guest companies with confirmed organization IDs', () => {
    expect(LINKEDIN_GROUP_B_TARGETS.length).toBe(7);
    const slugs = LINKEDIN_GROUP_B_TARGETS.map((t) => t.slug);
    expect(slugs).toContain('ringcentral');
    expect(slugs).toContain('cloudlinux');
    expect(slugs).toContain('ciklum');
    expect(slugs).toContain('astound-commerce');
    expect(slugs).toContain('indrive');
    expect(slugs).toContain('wallarm');
    expect(slugs).toContain('datadome');
  });

  it('fetches real live vacancies for DataDome via guest API without authorization', async () => {
    const target = LINKEDIN_GROUP_B_TARGETS.find((t) => t.slug === 'datadome')!;
    const vacancies = await fetchLinkedinCompanyVacancies(target, { maxPages: 1 });

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('DataDome');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/);
    expect(first.provenance.sourceId).toBe('src-linkedin-datadome');
    expect(first.title.length).toBeGreaterThan(0);
  });

  it('fetches real live vacancies for RingCentral via guest API without authorization', async () => {
    const target = LINKEDIN_GROUP_B_TARGETS.find((t) => t.slug === 'ringcentral')!;
    const vacancies = await fetchLinkedinCompanyVacancies(target, { maxPages: 1 });

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('RingCentral');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/);
    expect(first.provenance.sourceId).toBe('src-linkedin-ringcentral');
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.description.length).toBeGreaterThan(0);
  });

  it('fetches real live vacancies and full description text for Wallarm via guest API', async () => {
    const target = LINKEDIN_GROUP_B_TARGETS.find((t) => t.slug === 'wallarm')!;
    const vacancies = await fetchLinkedinCompanyVacancies(target, {
      maxPages: 1,
      fetchFullText: true,
    });

    expect(vacancies.length).toBeGreaterThan(0);
    const first = vacancies[0]!;
    expect(first.company).toBe('Wallarm');
    expect(first.title).toBe('Demand Generation Manager');
    expect(first.status).toBe('active');
    expect(first.url).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/);
    // Verified that full detail text is loaded
    expect(first.description.length).toBeGreaterThan(100);
  });

  it('parses fixture cards correctly when customFetch is injected', async () => {
    const fixtureHtml = `
      <ul>
        <li>
          <div class="job-search-card" data-entity-urn="urn:li:jobPosting:99999999">
            <h3 class="base-search-card__title">Senior Test Engineer</h3>
            <h4 class="base-search-card__subtitle"><a class="hidden-nested-link">RingCentral</a></h4>
            <span class="job-search-card__location">Remote, US</span>
            <time datetime="2026-11-01"></time>
          </div>
        </li>
      </ul>
    `;

    const mockFetch = async () =>
      new Response(fixtureHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });

    const target = { slug: 'ringcentral', company: 'RingCentral', organizationId: '60868' };
    const vacancies = await fetchLinkedinCompanyVacancies(target, {
      maxPages: 1,
      customFetch: mockFetch as unknown as typeof fetch,
    });

    expect(vacancies.length).toBe(1);
    expect(vacancies[0]!.id).toBe('src-linkedin-ringcentral:99999999');
    expect(vacancies[0]!.title).toBe('Senior Test Engineer');
    expect(vacancies[0]!.company).toBe('RingCentral');
    expect(vacancies[0]!.location).toBe('Remote, US');
    expect(vacancies[0]!.isRemote).toBe(true);
    expect(vacancies[0]!.status).toBe('active');
  });
});
