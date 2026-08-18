import { describe, expect, it } from 'vitest';
import { parseRssJobFeed } from './rssFeedParser';

describe('RSS / XML Job Feed Parser', () => {
  const sampleRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>TechCorp Careers</title>
    <link>https://techcorp.com/careers</link>
    <description>Open positions at TechCorp</description>
    <item>
      <title>Staff Software Engineer (Node.js &amp; TypeScript)</title>
      <link>https://techcorp.com/careers/staff-se-101</link>
      <guid>https://techcorp.com/careers/staff-se-101</guid>
      <pubDate>Mon, 17 Aug 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[We are seeking a Staff Software Engineer to lead backend architecture. Requirements: Node.js, TypeScript, PostgreSQL, Redis. Remote friendly.]]></description>
    </item>
  </channel>
</rss>`;

  it('parses an RSS career feed into structured UnifiedVacancy items', () => {
    const vacancies = parseRssJobFeed(sampleRssXml, {
      sourceId: 'techcorp-careers',
      sourceUrl: 'https://techcorp.com/careers/rss.xml',
      companyName: 'TechCorp',
      observedAt: '2026-08-18T00:00:00.000Z',
    });

    expect(vacancies).toHaveLength(1);
    const job = vacancies[0];
    expect(job.title).toBe('Staff Software Engineer (Node.js & TypeScript)');
    expect(job.company).toBe('TechCorp');
    expect(job.url).toBe('https://techcorp.com/careers/staff-se-101');
    expect(job.requiredSkills).toContain('Node.js');
    expect(job.requiredSkills).toContain('TypeScript');
    expect(job.requiredSkills).toContain('PostgreSQL');
    expect(job.isRemote).toBe(true);
    expect(job.provenance.sourceType).toBe('rss');
  });
});
