import { describe, expect, it } from 'vitest';
import { parseLinkedinJobHtml, parseLinkedinJobCards } from '../linkedinParser';

describe('Linkedin job HTML parser', () => {
  const sampleCardHtml = `
    <li data-occludable-job-id="3948571029">
      <div class="base-card">
        <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/3948571029?refId=123">
          <span class="sr-only">Staff Infrastructure Engineer</span>
        </a>
        <div class="base-search-card__info">
          <h3 class="base-search-card__title">Staff Infrastructure Engineer</h3>
          <h4 class="base-search-card__subtitle">
            <a href="https://www.linkedin.com/company/stripe">Stripe</a>
          </h4>
          <span class="job-search-card__location">Remote in United States</span>
          <time class="job-search-card__listdate" datetime="2026-09-04">2 days ago</time>
        </div>
      </div>
    </li>
  `;

  it('parses structured job card into UnifiedVacancy fields', () => {
    const vacancies = parseLinkedinJobCards(sampleCardHtml, {
      observedAt: '2026-09-06T00:00:00.000Z',
    });

    expect(vacancies).toHaveLength(1);
    const v = vacancies[0];
    expect(v.title).toBe('Staff Infrastructure Engineer');
    expect(v.company).toBe('Stripe');
    expect(v.location).toBe('Remote in United States');
    expect(v.isRemote).toBe(true);
    expect(v.url).toContain('linkedin.com/jobs/view/3948571029');
    expect(v.provenance.sourceId).toBe('src-linkedin-pool');
    expect(v.provenance.externalId).toBe('3948571029');
  });

  it('rejects cards missing mandatory attributes (company, title, or url)', () => {
    const malformed = `<li><div class="base-card"><h3>Untitled</h3></div></li>`;
    const vacancies = parseLinkedinJobCards(malformed, {
      observedAt: '2026-09-06T00:00:00.000Z',
    });
    expect(vacancies).toHaveLength(0);
  });

  it('parses full job detail page HTML', () => {
    const detailHtml = `
      <html>
        <body>
          <h1 class="topcard__title">Principal Backend Architect</h1>
          <a class="topcard__org-name-link">Docker, Inc</a>
          <span class="topcard__flavor--bullet">Berlin, Germany</span>
          <div class="show-more-less-html__markup">
            We are looking for a Principal Architect with Go and Kubernetes experience.
          </div>
        </body>
      </html>
    `;

    const detail = parseLinkedinJobHtml(detailHtml, {
      jobId: '11223344',
      url: 'https://www.linkedin.com/jobs/view/11223344',
      observedAt: '2026-09-06T00:00:00.000Z',
    });

    expect(detail).toBeDefined();
    expect(detail?.title).toBe('Principal Backend Architect');
    expect(detail?.company).toBe('Docker, Inc');
    expect(detail?.location).toBe('Berlin, Germany');
    expect(detail?.description).toContain('Go and Kubernetes experience');
  });
});
