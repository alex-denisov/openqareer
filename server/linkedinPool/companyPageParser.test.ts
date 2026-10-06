import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  linkedinPageNeedsReauth,
  parseLinkedinCompanyPeoplePageHtml,
  parseLinkedinCompanySearchPageHtml,
} from './companyPageParser';

const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/company-people-page.html', import.meta.url)),
  'utf8',
);

describe('parseLinkedinCompanyPeoplePageHtml', () => {
  it('keeps only LinkedIn recruiter profiles and stores the minimum fields', () => {
    expect(parseLinkedinCompanyPeoplePageHtml(fixture)).toEqual([
      {
        fullName: 'Riley Example',
        roleTitle: 'Senior Talent Acquisition Partner',
        linkedinUrl: 'https://www.linkedin.com/in/riley-example',
      },
    ]);
  });

  it('ignores malformed or unsupported markup', () => {
    expect(parseLinkedinCompanyPeoplePageHtml('<html><body>Nothing to parse</body></html>')).toEqual(
      [],
    );
  });

  it('selects only the exact same-site company result', () => {
    const html = `
      <a href="/company/northwind-group/">Northwind Group</a>
      <a href="https://evil.example/company/northwind-group/">Northwind Group</a>
      <a href="/company/northwind-group-copy/">Northwind Group Copy</a>`;
    expect(parseLinkedinCompanySearchPageHtml(html, 'Northwind Group')).toBe(
      'https://www.linkedin.com/company/northwind-group',
    );
  });

  it('stops on login, checkpoint and provider rate-limit responses', () => {
    expect(
      linkedinPageNeedsReauth({
        statusCode: 200,
        url: 'https://www.linkedin.com/checkpoint/challenge',
        html: '<main>Verify your identity</main>',
      }),
    ).toBe(true);
    expect(
      linkedinPageNeedsReauth({
        statusCode: 429,
        url: 'https://www.linkedin.com/company/northwind-group/people/',
        html: '<main>Too many requests</main>',
      }),
    ).toBe(true);
    expect(
      linkedinPageNeedsReauth({
        statusCode: 200,
        url: 'https://www.linkedin.com/company/northwind-group/people/',
        html: '<main>Team</main>',
      }),
    ).toBe(false);
  });

  it('does not pause for warning phrases in ordinary company-page content', () => {
    expect(
      linkedinPageNeedsReauth({
        statusCode: 200,
        url: 'https://www.linkedin.com/company/northwind-group/people/',
        html: '<main><p>Our team handled unusual activity and access-denied workflows.</p></main>',
      }),
    ).toBe(false);
  });

  it('recognizes verification text inside a LinkedIn-marked safety surface', () => {
    expect(
      linkedinPageNeedsReauth({
        statusCode: 200,
        url: 'https://www.linkedin.com/company/northwind-group/people/',
        html: '<main data-test-id="security-verification"><h1>Verify your identity</h1></main>',
      }),
    ).toBe(true);
  });
});
