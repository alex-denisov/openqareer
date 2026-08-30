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

describe('what the candidate actually reads (B164)', () => {
  const meta = {
    sourceId: 'src-himalayas',
    sourceUrl: 'https://himalayas.app/jobs/rss',
    observedAt: '2026-08-30T12:00:00.000Z',
  };

  const feed = `<?xml version="1.0"?><rss><channel>
    <item>
      <title><![CDATA[Senior Technical Support Engineer]]></title>
      <link>https://himalayas.app/jobs/one</link>
      <guid>https://himalayas.app/jobs/one</guid>
      <pubDate>Sat, 30 Aug 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[Remote&nbsp;role at Acme&nbsp;&amp;&nbsp;Co &#8212; TypeScript &#x26; React]]></description>
    </item>
  </channel></rss>`;

  it('shows a title without the feed’s own CDATA wrapper', () => {
    const [vacancy] = parseRssJobFeed(feed, meta);
    expect(vacancy.title).toBe('Senior Technical Support Engineer');
  });

  it('decodes the entities a feed escapes instead of printing them raw', () => {
    const [vacancy] = parseRssJobFeed(feed, meta);
    expect(vacancy.description).toBe(
      'Remote role at Acme & Co — TypeScript & React',
    );
    expect(vacancy.description).not.toContain('&nbsp;');
    expect(vacancy.description).not.toContain('&#');
  });
});

describe('feeds that escape a whole HTML body (B164)', () => {
  it('reads the escaped markup to its end instead of stopping one level short', () => {
    const [vacancy] = parseRssJobFeed(
      `<rss><channel><item>
        <title>Role</title>
        <link>https://example.test/1</link>
        <guid>https://example.test/1</guid>
        <description>&lt;p&gt;Remote&amp;nbsp;role at Acme&lt;/p&gt;</description>
      </item></channel></rss>`,
      {
        sourceId: 'src-test',
        sourceUrl: 'https://example.test/rss',
        observedAt: '2026-08-30T12:00:00.000Z',
      },
    );
    // We Work Remotely publishes exactly this shape: HTML escaped once, so its
    // own `&nbsp;` arrives as `&amp;nbsp;`. Decoding only the XML layer left
    // `<p>` and `&nbsp;` in the card (B164 prod walk).
    expect(vacancy.description).toBe('Remote role at Acme');
  });
});
