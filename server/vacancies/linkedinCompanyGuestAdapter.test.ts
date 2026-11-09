import { describe, expect, it } from 'vitest';
import {
  fetchLinkedinCompanyVacancies,
  LINKEDIN_GROUP_B_TARGETS,
} from './linkedinCompanyGuestAdapter';
import { useRecordedFetch } from './__fixtures__/recordedFetch';

describe('LinkedIn Company Guest Adapter (Group B)', () => {
  useRecordedFetch('linkedinCompanyGuestAdapter');
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

  it('fetches real live vacancies and description text for Wallarm via guest API', async () => {
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
    expect(first.description.length).toBeGreaterThan(0);
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

  it('fetches and parses full job description when customFetch is injected and fetchFullText is enabled', async () => {
    const fixtureListHtml = `
      <ul>
        <li>
          <div class="job-search-card" data-entity-urn="urn:li:jobPosting:88888888">
            <h3 class="base-search-card__title">Senior Security Architect</h3>
            <h4 class="base-search-card__subtitle"><a class="hidden-nested-link">Wallarm</a></h4>
            <span class="job-search-card__location">San Francisco, CA</span>
          </div>
        </li>
      </ul>
    `;
    const fixtureDetailHtml = `
      <section class="description">
        <div class="show-more-less-html__markup">
          <p>We are looking for an experienced Senior Security Architect to lead our cloud protection team.</p>
          <p>Key responsibilities include API security and runtime protection architecture.</p>
        </div>
      </section>
    `;

    const mockFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('seeMoreJobPostings')) {
        return new Response(fixtureListHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return new Response(fixtureDetailHtml, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    };

    const target = { slug: 'wallarm', company: 'Wallarm', organizationId: '3200155' };
    const vacancies = await fetchLinkedinCompanyVacancies(target, {
      maxPages: 1,
      fetchFullText: true,
      customFetch: mockFetch as unknown as typeof fetch,
    });

    expect(vacancies.length).toBe(1);
    expect(vacancies[0]!.title).toBe('Senior Security Architect');
    expect(vacancies[0]!.description).toContain('Key responsibilities include API security');
    expect(vacancies[0]!.description.length).toBeGreaterThan(100);
  });
});

describe('LinkedIn company search address (B622)', () => {
  it('asks for the worldwide geoId, without which f_C answers an empty page', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    await fetchLinkedinCompanyVacancies(
      { slug: 'x', company: 'X', organizationId: '42' },
      { maxPages: 1, customFetch: fakeFetch },
    );
    expect(urls[0]).toContain('f_C=42&geoId=92000000&start=0');
  });
});
