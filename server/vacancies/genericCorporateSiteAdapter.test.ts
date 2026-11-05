import { describe, it, expect } from 'vitest';
import {
  extractJsonLdJobs,
  extractNextDataJobs,
  extractSemanticHtmlJobs,
  detectEmbeddedAts,
} from './genericCorporateSiteAdapter';

describe('genericCorporateSiteAdapter', () => {
  it('extracts Schema.org JSON-LD JobPosting vacancies accurately', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "JobPosting",
          "title": "Senior Frontend Engineer",
          "description": "We are seeking a talented Senior Frontend Engineer to join our team.",
          "identifier": {
            "@type": "PropertyValue",
            "name": "Acme Corp",
            "value": "JOB-12345"
          },
          "datePosted": "2026-11-05",
          "employmentType": "FULL_TIME",
          "hiringOrganization": {
            "@type": "Organization",
            "name": "Acme Corp"
          },
          "jobLocation": {
            "@type": "Place",
            "address": {
              "@type": "PostalAddress",
              "addressLocality": "Berlin",
              "addressCountry": "Germany"
            }
          },
          "url": "https://careers.acme.com/jobs/senior-frontend-engineer-12345"
        }
        </script>
      </head>
      <body><h1>Careers</h1></body>
      </html>
    `;

    const jobs = extractJsonLdJobs(html, 'https://careers.acme.com');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Senior Frontend Engineer');
    expect(jobs[0].externalId).toBe('JOB-12345');
    expect(jobs[0].location).toBe('Berlin, Germany');
    expect(jobs[0].url).toBe('https://careers.acme.com/jobs/senior-frontend-engineer-12345');
    expect(jobs[0].publishedAt).toBe('2026-11-05');
  });

  it('extracts Next.js __NEXT_DATA__ vacancies', () => {
    const html = `
      <html>
      <body>
        <script id="__NEXT_DATA__" type="application/json">
        {
          "props": {
            "pageProps": {
              "vacancies": [
                {
                  "id": "vac-999",
                  "title": "Principal Backend Architect",
                  "location": "Remote, Europe",
                  "url": "https://company.com/careers/backend-architect"
                }
              ]
            }
          }
        }
        </script>
      </body>
      </html>
    `;

    const jobs = extractNextDataJobs(html, 'https://company.com/careers');
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe('Principal Backend Architect');
    expect(jobs[0].externalId).toBe('vac-999');
    expect(jobs[0].location).toBe('Remote, Europe');
    expect(jobs[0].isRemote).toBe(true);
  });

  it('extracts semantic HTML job links when no structured metadata is present', () => {
    const html = `
      <div class="career-page">
        <h2>Open Roles</h2>
        <ul class="job-list">
          <li>
            <a href="/jobs/staff-infrastructure-engineer">
              <h3>Staff Infrastructure Engineer</h3>
            </a>
            <span class="location">San Francisco, CA</span>
          </li>
          <li>
            <a href="/vacancies/lead-product-designer">Lead Product Designer</a>
          </li>
          <li>
            <a href="/careers/all-jobs">View All Openings</a>
          </li>
        </ul>
      </div>
    `;

    const jobs = extractSemanticHtmlJobs(html, 'https://example.com/careers');
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe('Staff Infrastructure Engineer');
    expect(jobs[0].url).toBe('https://example.com/jobs/staff-infrastructure-engineer');
    expect(jobs[1].title).toBe('Lead Product Designer');
    expect(jobs[1].url).toBe('https://example.com/vacancies/lead-product-designer');
  });

  it('detects embedded ATS services on the corporate career page', () => {
    const htmlGreenhouse = `<iframe src="https://boards.greenhouse.io/databricks" />`;
    const gh = detectEmbeddedAts(htmlGreenhouse);
    expect(gh?.provider).toBe('greenhouse');
    expect(gh?.endpointUrl).toBe('https://boards-api.greenhouse.io/v1/boards/databricks/jobs');

    const htmlWorkday = `<a href="https://leonardocompany.wd3.myworkdayjobs.com/LeonardoCareerSite/job/1">Apply on Workday</a>`;
    const wd = detectEmbeddedAts(htmlWorkday);
    expect(wd?.provider).toBe('workday');
    expect(wd?.endpointUrl).toBe(
      'https://leonardocompany.wd3.myworkdayjobs.com/wday/cxs/leonardocompany/LeonardoCareerSite/jobs',
    );
  });
});
