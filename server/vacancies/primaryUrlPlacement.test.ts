import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { createClusterFromVacancy, mergeVacancyIntoCluster } from './vacancyDeduplicator';

function from(sourceId: string, url: string, title: string, sourceType: UnifiedVacancy['provenance']['sourceType'] = 'json_api'): UnifiedVacancy {
  return {
    id: `${sourceId}-1`, fingerprint: 'fp', title, company: `Acme via ${sourceId}`, isRemote: true,
    description: 'Head of Data', requiredSkills: [], url,
    provenance: { sourceType, sourceId, sourceUrl: url, observedAt: '2026-11-11T00:00:00.000Z' },
    publishedAt: '2026-11-10T00:00:00.000Z', status: 'active',
  };
}

const site = from('src-company-site-acme', 'https://acme.com/careers/1', 'Head of Data (site)', 'career_site');
const ats = from('ats-greenhouse-acme', 'https://job-boards.greenhouse.io/acme/jobs/1', 'Head of Data (ats)');
const linkedin = from('src-company-li-acme', 'https://www.linkedin.com/jobs/view/1', 'Head of Data (li)');
const hhWithAtsLink = from('src-hh-search', 'https://jobs.lever.co/acme/1', 'Head of Data (hh)');

function merged(first: UnifiedVacancy, second: UnifiedVacancy) {
  const cluster = createClusterFromVacancy(first);
  mergeVacancyIntoCluster(cluster, second);
  return { url: cluster.primaryUrl, title: cluster.canonicalTitle, company: cluster.canonicalCompany };
}

describe('B643-7: link follows placement priority, title and company do not move', () => {
  it('site link beats an ATS link that came first', () => {
    expect(merged(ats, site)).toEqual({ url: site.url, title: ats.title, company: ats.company });
  });
  it('an ATS link arriving after the site does not replace it', () => {
    expect(merged(site, ats)).toEqual({ url: site.url, title: site.title, company: site.company });
  });
  it('ATS link beats the company LinkedIn channel', () => {
    expect(merged(linkedin, ats)).toEqual({ url: ats.url, title: linkedin.title, company: linkedin.company });
  });
  it('employer board beats an aggregator row that carried an ATS link', () => {
    expect(merged(hhWithAtsLink, ats)).toEqual({ url: ats.url, title: hhWithAtsLink.title, company: hhWithAtsLink.company });
  });
});
