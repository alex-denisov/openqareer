import { describe, expect, it } from 'vitest';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import {
  fetchYcWorkAtStartup,
  parseYcWorkAtStartupPage,
  YC_JOB_PATHS,
  YC_WORK_AT_STARTUP_SOURCE_ID,
} from './ycWorkAtStartupSource';

const SOURCE: VacancySourceConfig = {
  id: YC_WORK_AT_STARTUP_SOURCE_ID,
  name: 'Y Combinator Work at a Startup',
  type: 'career_site',
  enabled: false,
  targetUrl: 'https://www.ycombinator.com/jobs',
  refreshIntervalMinutes: 360,
  itemsFoundTotal: 0,
  itemsActiveTotal: 0,
};

function page(jobPostings: unknown[]): string {
  const payload = JSON.stringify({ props: { jobPostings } });
  const escaped = payload
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<div data-page="${escaped}"></div>`;
}

const JOB = {
  id: 101,
  title: 'Engineering Manager',
  url: '/companies/acme/jobs/abc-engineering-manager',
  location: 'Remote (US)',
  type: 'Full-time',
  roleSpecificType: 'Engineering',
  prettyRole: 'Engineering',
  minExperience: '5+ years',
  skills: ['TypeScript', 'Leadership'],
  companyName: 'Acme AI',
  companyOneLiner: 'Tools for reliable AI products.',
  createdAt: '12 days',
  salaryRange: '$180K - $240K',
};

describe('YC Work at a Startup source', () => {
  it('parses the escaped public embedded payload without entering the application flow', () => {
    const [vacancy] = parseYcWorkAtStartupPage(
      page([JOB]),
      SOURCE,
      'https://www.ycombinator.com/jobs/role/operations',
      '2026-09-21T12:00:00.000Z',
    );

    expect(vacancy).toMatchObject({
      id: `${YC_WORK_AT_STARTUP_SOURCE_ID}:101`,
      title: 'Engineering Manager',
      company: 'Acme AI',
      location: 'Remote (US)',
      isRemote: true,
      url: 'https://www.ycombinator.com/companies/acme/jobs/abc-engineering-manager',
      employmentType: 'Full-time',
      experienceLevel: '5+ years',
      requiredSkills: ['TypeScript', 'Leadership'],
      provenance: {
        sourceType: 'career_site',
        sourceId: YC_WORK_AT_STARTUP_SOURCE_ID,
        sourceUrl: 'https://www.ycombinator.com/jobs/role/operations',
        externalId: '101',
      },
      publishedAt: '2026-09-09T12:00:00.000Z',
    });
    expect(vacancy?.description).toContain('$180K - $240K');
  });

  it('rejects an HTML shell without the public job payload', () => {
    expect(() =>
      parseYcWorkAtStartupPage(
        '<html><title>maintenance</title></html>',
        SOURCE,
        SOURCE.targetUrl,
        '2026-09-21T12:00:00.000Z',
      ),
    ).toThrow('vacancy_source_payload_unreadable');
  });

  it('drops a job whose external link is not http(s)', () => {
    const [vacancy] = parseYcWorkAtStartupPage(
      page([{ ...JOB, url: 'javascript:alert(1)' }]),
      SOURCE,
      SOURCE.targetUrl,
      '2026-09-21T12:00:00.000Z',
    );

    expect(vacancy).toBeUndefined();
  });

  it('drops a job link that leaves the official YC host', () => {
    const [vacancy] = parseYcWorkAtStartupPage(
      page([{ ...JOB, url: '//internal.example.test/job' }]),
      SOURCE,
      SOURCE.targetUrl,
      '2026-09-21T12:00:00.000Z',
    );

    expect(vacancy).toBeUndefined();
  });

  it('reads a bounded set of role pages and deduplicates a repeated job', async () => {
    const seen: string[] = [];
    const reading = await fetchYcWorkAtStartup(SOURCE, async (url) => {
      seen.push(url);
      return new Response(page([JOB]), { status: 200, headers: { 'content-type': 'text/html' } });
    });

    expect(seen).toEqual(YC_JOB_PATHS.map((path) => `https://www.ycombinator.com/${path}`));
    expect(reading.partial).toBe(false);
    expect(reading.vacancies).toHaveLength(1);
    expect(reading.vacancies[0]?.provenance.sourceType).toBe('career_site');
  });

  it('does not let a changed registry target redirect the adapter', async () => {
    const seen: string[] = [];
    await fetchYcWorkAtStartup({ ...SOURCE, targetUrl: 'https://internal.example.test/jobs' }, async (url) => {
      seen.push(url);
      return new Response(page([]), { status: 200, headers: { 'content-type': 'text/html' } });
    });

    expect(seen).toEqual(YC_JOB_PATHS.map((path) => `https://www.ycombinator.com/${path}`));
  });
});
