import { describe, expect, it } from 'vitest';
import { parseJobPostingJsonLd } from './jobPostingParser';

const sourceUrl = 'https://careers.synthetic.test/jobs/product-lead';

describe('JSON-LD job posting parser', () => {
  it('normalizes a public company JobPosting while retaining provenance', () => {
    const html = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            {"@type": "Organization", "name": "Ignored node"},
            {
              "@type": "JobPosting",
              "identifier": {"value": "REQ-42"},
              "title": "Product Lead",
              "datePosted": "2026-08-05",
              "employmentType": ["FULL_TIME"],
              "hiringOrganization": {"name": "Synthetic Product Company"},
              "jobLocation": {
                "address": {
                  "addressLocality": "Berlin",
                  "addressCountry": "DE"
                }
              },
              "url": "https://careers.synthetic.test/jobs/product-lead"
            }
          ]
        }
      </script>`;

    expect(
      parseJobPostingJsonLd(html, {
        sourceId: 'synthetic-company-careers',
        sourceUrl,
        observedAt: '2026-08-06T12:00:00.000Z',
      }),
    ).toEqual([
      {
        nativeId: 'REQ-42',
        title: 'Product Lead',
        company: 'Synthetic Product Company',
        location: { city: 'Berlin', country: 'DE' },
        employmentTypes: ['FULL_TIME'],
        canonicalUrl: sourceUrl,
        publishedAt: '2026-08-05',
        provenance: {
          sourceId: 'synthetic-company-careers',
          sourceUrl,
          observedAt: '2026-08-06T12:00:00.000Z',
          transport: 'public_http_parser',
        },
      },
    ]);
  });

  it('skips malformed and non-job JSON-LD without inventing a vacancy', () => {
    const html = `
      <script type="application/ld+json">not-json</script>
      <script type="application/ld+json">{"@type":"Organization","name":"Synthetic"}</script>`;

    expect(
      parseJobPostingJsonLd(html, {
        sourceId: 'synthetic-company-careers',
        sourceUrl,
        observedAt: '2026-08-06T12:00:00.000Z',
      }),
    ).toEqual([]);
  });

  it('rejects oversized HTML and non-HTTPS source boundaries', () => {
    const provenance = {
      sourceId: 'synthetic-company-careers',
      sourceUrl,
      observedAt: '2026-08-06T12:00:00.000Z',
    };

    expect(() => parseJobPostingJsonLd('x'.repeat(1_000_001), provenance)).toThrow(
      'job_source_html_too_large',
    );
    expect(() =>
      parseJobPostingJsonLd('<html></html>', {
        ...provenance,
        sourceUrl: 'file:///private/source.html',
      }),
    ).toThrow('job_source_url_invalid');
  });

  it('handles array payloads, object country values and unsafe canonical URLs', () => {
    const html = `<script type='application/ld+json'>[
      null,
      {
        "@type": ["Thing", "JobPosting"],
        "title": "Data Lead",
        "employmentType": "FULL_TIME",
        "url": "javascript:alert(1)",
        "jobLocation": [{
          "address": {
            "addressCountry": {"name": "DE"}
          }
        }]
      }
    ]</script>`;

    expect(
      parseJobPostingJsonLd(html, {
        sourceId: 'synthetic-company-careers',
        sourceUrl,
        observedAt: '2026-08-06T12:00:00.000Z',
      }),
    ).toEqual([
      expect.objectContaining({
        nativeId: null,
        title: 'Data Lead',
        company: null,
        location: { country: 'DE' },
        employmentTypes: ['FULL_TIME'],
        canonicalUrl: sourceUrl,
        publishedAt: null,
      }),
    ]);
  });

  it('falls back to the source URL when a canonical URL is malformed', () => {
    const html = `<script type="application/ld+json">{
      "@type": "JobPosting",
      "title": "Operations Lead",
      "url": "not a URL",
      "jobLocation": {"address": "remote"}
    }</script>`;

    expect(
      parseJobPostingJsonLd(html, {
        sourceId: 'synthetic-company-careers',
        sourceUrl,
        observedAt: '2026-08-06T12:00:00.000Z',
      })[0],
    ).toMatchObject({ canonicalUrl: sourceUrl, location: null });
  });

  it('stops pathological JSON-LD nesting before it can exhaust the process stack', () => {
    const nested = `${'['.repeat(1_001)}null${']'.repeat(1_001)}`;
    const html = `<script type="application/ld+json">${nested}</script>`;

    expect(() =>
      parseJobPostingJsonLd(html, {
        sourceId: 'synthetic-company-careers',
        sourceUrl,
        observedAt: '2026-08-06T12:00:00.000Z',
      }),
    ).toThrow('job_source_jsonld_too_complex');
  });
});
