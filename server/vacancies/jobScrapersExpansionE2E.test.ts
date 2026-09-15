import { describe, expect, it } from 'vitest';
import { normalizeJsonSource } from './jsonSourceAdapters';
import { normalizeBaytHtml } from './jobspyAdapters';
import { clusterVacancies } from './vacancyDeduplicator';
import { renderUnifiedVacancyView } from './renderVacancyTemplate';
import { buildVacancyDetail } from './vacancyCatalogPage';
import { renderVacancyDocument } from './vacancyCatalogDocument';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';

describe('Job Scrapers Expansion & LinkedIn Template E2E Pipeline', () => {
  const baseObservedAt = '2026-09-14T12:00:00.000Z';

  it('ingests, deduplicates, and renders vacancies across all expanded sources', () => {
    // 1. Qualcomm Eightfold
    const qualcommPayload = {
      count: 1,
      positions: [
        {
          id: 991,
          name: 'Staff Wireless Systems Engineer',
          canonicalPositionUrl: 'https://careers.qualcomm.com/jobs/991',
          location: 'San Diego, CA',
          jobDescription: 'Design next-generation 5G/6G modem architectures. Requirements: 5+ years in wireless DSP.',
          standardJobPostingUpdatedDate: '2026-09-14T08:00:00.000Z',
        },
      ],
    };
    const qualcommJobs = normalizeJsonSource(
      'src-qualcomm-careers',
      qualcommPayload,
      {
        observedAt: baseObservedAt,
        sourceName: 'Qualcomm',
        sourceUrl: 'https://careers.qualcomm.com/api/pcsx/search?domain=qualcomm.com',
      },
    );
    expect(qualcommJobs).toHaveLength(1);
    expect(qualcommJobs[0]?.company).toBe('Qualcomm');

    // 2. Snap Workday
    const snapPayload = {
      total: 1,
      jobPostings: [
        {
          bulletFields: ['R10001'],
          title: 'Software Engineer - Camera Systems',
          externalPath: '/job/R10001',
          locationsText: 'Los Angeles, CA',
          postedOn: 'Posted Today',
        },
      ],
    };
    const snapJobs = normalizeJsonSource(
      'ats-workday-snapchat',
      snapPayload,
      {
        observedAt: baseObservedAt,
        sourceName: 'Snap',
        sourceUrl: 'https://snapchat.wd1.myworkdayjobs.com/wday/cxs/snapchat/snap/jobs',
      },
    );
    expect(snapJobs).toHaveLength(1);
    expect(snapJobs[0]?.company).toBe('Snap');

    // 3. Sony Workday
    const sonyPayload = {
      total: 1,
      jobPostings: [
        {
          bulletFields: ['S99'],
          title: 'Senior PlayStation Platform Architect',
          externalPath: '/job/S99',
          locationsText: 'San Mateo, CA',
          postedOn: 'Posted Today',
        },
      ],
    };
    const sonyJobs = normalizeJsonSource(
      'ats-workday-sonyglobal',
      sonyPayload,
      {
        observedAt: baseObservedAt,
        sourceName: 'Sony',
        sourceUrl: 'https://sonyglobal.wd1.myworkdayjobs.com/wday/cxs/sonyglobal/SonyGlobalCareers/jobs',
      },
    );
    expect(sonyJobs).toHaveLength(1);
    expect(sonyJobs[0]?.company).toBe('Sony');

    // 4. Breezy HR
    const breezyPayload = [
      {
        id: 'bz-101',
        name: 'Full Stack TypeScript Engineer',
        url: 'https://acme.breezy.hr/p/bz-101',
        department: 'Core Platform',
        location: { name: 'Remote, US', is_remote: true },
        type: { name: 'Full-Time' },
      },
    ];
    const breezyJobs = normalizeJsonSource(
      'ats-breezy-acme',
      breezyPayload,
      { observedAt: baseObservedAt, sourceName: 'Acme', sourceUrl: 'https://acme.breezy.hr/json' },
    );
    expect(breezyJobs).toHaveLength(1);
    expect(breezyJobs[0]?.isRemote).toBe(true);

    // 5. Pinpoint
    const pinpointPayload = {
      data: [
        {
          id: 'pin-202',
          title: 'DevOps & Reliability Engineer',
          url: 'https://acme.pinpointhq.com/postings/pin-202',
          department: { name: 'Infrastructure' },
          location: { name: 'London, UK' },
          employment_type: 'full_time',
        },
      ],
    };
    const pinpointJobs = normalizeJsonSource(
      'ats-pinpoint-pinpoint',
      pinpointPayload,
      { observedAt: baseObservedAt, sourceName: 'Pinpoint', sourceUrl: 'https://pinpoint.pinpointhq.com/postings.json' },
    );
    expect(pinpointJobs).toHaveLength(1);
    expect(pinpointJobs[0]?.location).toBe('London, UK');

    // 6. SmartRecruiters (Unlocked)
    const smartRecruitersPayload = {
      content: [
        {
          id: 'sr-303',
          name: 'Principal Payment Systems Architect',
          refNumber: 'VISA-303',
          location: { city: 'Foster City', region: 'CA', country: 'us' },
          releasedDate: '2026-09-14T10:00:00.000Z',
        },
      ],
    };
    const srJobs = normalizeJsonSource(
      'ats-smartrecruiters-visa',
      smartRecruitersPayload,
      { observedAt: baseObservedAt, sourceName: 'Visa', sourceUrl: 'https://api.smartrecruiters.com/v1/companies/visa/postings' },
    );
    expect(srJobs).toHaveLength(1);

    // 7. Hacker News "Who is hiring"
    const hnPayload = {
      hits: [
        {
          objectID: 'hn-404',
          parent_id: 12345,
          created_at: '2026-09-14T00:00:00.000Z',
          comment_text:
            'SuperTech | Staff Distributed Systems Engineer | Remote | $190k - $240k<p>We build global key-value storage. Tech stack: Go, Rust, Raft, Kubernetes.</p>',
        },
      ],
    };
    const hnJobs = normalizeJsonSource(
      'src-hn-whoishiring',
      hnPayload,
      { observedAt: baseObservedAt, sourceName: 'Hacker News', sourceUrl: 'https://news.ycombinator.com' },
    );
    expect(hnJobs).toHaveLength(1);
    expect(hnJobs[0]?.company).toBe('SuperTech');
    expect(hnJobs[0]?.salary?.from).toBe(190000);

    // 8. Naukri (JobSpy)
    const naukriPayload = {
      noOfJobs: 1,
      jobDetails: [
        {
          jobId: 'nk-505',
          title: 'Senior Backend Engineer - Distributed Systems',
          companyName: 'Flipkart',
          placeholders: [
            { type: 'location', label: 'Bengaluru, India' },
            { type: 'salary', label: '25-40 Lacs P.A.' },
          ],
          jobDescription: 'Lead backend microservices in Java and Go. High scale systems.',
          tagsAndSkills: 'Java, Go, Kafka, Cassandra, Kubernetes',
          createdDate: 1726300000000,
        },
      ],
    };
    const naukriJobs = normalizeJsonSource(
      'src-naukri',
      naukriPayload,
      { observedAt: baseObservedAt, sourceName: 'Naukri', sourceUrl: 'https://www.naukri.com' },
    );
    expect(naukriJobs).toHaveLength(1);
    expect(naukriJobs[0]?.salary?.currency).toBe('INR');

    // 9. BDJobs (JobSpy)
    const bdjobsPayload = {
      data: [
        {
          jobid: 'bd-606',
          jobtitle: 'Lead Software Architect',
          companyname: 'Pathao',
          location: 'Dhaka, Bangladesh',
          jobnature: 'Full Time',
          jobdescription: 'Architect logistics and delivery dispatch engine.',
          deadline: '2026-10-01',
        },
      ],
    };
    const bdjobsJobs = normalizeJsonSource(
      'src-bdjobs',
      bdjobsPayload,
      { observedAt: baseObservedAt, sourceName: 'BDJobs', sourceUrl: 'https://jobs.bdjobs.com' },
    );
    expect(bdjobsJobs).toHaveLength(1);

    // 10. ZipRecruiter (JobSpy)
    const zipPayload = {
      total_jobs: 1,
      jobs: [
        {
          id: 'zr-707',
          name: 'Cloud Infrastructure Architect',
          hiring_company: { name: 'Datadog' },
          location: 'New York, NY',
          salary_min: 180000,
          salary_max: 220000,
          url: 'https://www.ziprecruiter.com/jobs/zr-707',
          posted_time: '2026-09-14T09:00:00Z',
          snippet: 'Build scalable observability infrastructure across AWS and GCP.',
        },
      ],
    };
    const zipJobs = normalizeJsonSource(
      'src-ziprecruiter',
      zipPayload,
      { observedAt: baseObservedAt, sourceName: 'ZipRecruiter', sourceUrl: 'https://www.ziprecruiter.com' },
    );
    expect(zipJobs).toHaveLength(1);
    expect(zipJobs[0]?.salary?.from).toBe(180000);

    // 11. Glassdoor (JobSpy)
    const glassdoorPayload = {
      data: {
        jobListings: [
          {
            jobview: {
              header: {
                employerNameFromSearch: 'GitHub',
                jobTitleText: 'Principal AI Systems Engineer',
                locationName: 'San Francisco, CA',
              },
              job: {
                listingId: 808,
                description:
                  'Lead Copilot core orchestration engine. We are an equal opportunity employer committed to diversity.',
              },
              salary: {
                payPeriod: 'ANNUAL',
                payCurrency: 'USD',
                baseSalary: { min: 210000, max: 280000 },
              },
            },
          },
        ],
      },
    };
    const glassdoorJobs = normalizeJsonSource(
      'src-glassdoor',
      glassdoorPayload,
      { observedAt: baseObservedAt, sourceName: 'Glassdoor', sourceUrl: 'https://www.glassdoor.com' },
    );
    expect(glassdoorJobs).toHaveLength(1);
    expect(glassdoorJobs[0]?.company).toBe('GitHub');

    // 12. Bayt (JobSpy)
    const baytHtml = `
      <div id="results_inner">
        <ul class="media-list">
          <li data-js-job="" data-job-id="bayt-909">
            <h2 class="jb-title"><a href="/en/jobs/bayt-909/">Senior Cloud Security Engineer</a></h2>
            <b class="jb-company">Careem</b>
            <span class="jb-loc">Dubai, UAE</span>
            <div class="jb-date">Today</div>
            <div class="jb-descr">Responsible for cloud infrastructure security and IAM architectures.</div>
          </li>
        </ul>
      </div>
    `;
    const baytJobs = normalizeBaytHtml(
      baytHtml,
      { observedAt: baseObservedAt, sourceName: 'Bayt', sourceUrl: 'https://www.bayt.com' },
      'src-bayt',
    );
    expect(baytJobs).toHaveLength(1);
    expect(baytJobs[0]?.company).toBe('Careem');

    // Combine all 12 vacancies + an intentional cross-source duplicate
    const duplicateOfQualcomm: UnifiedVacancy = {
      ...qualcommJobs[0]!,
      id: 'dup-zip-qualcomm',
      provenance: {
        ...qualcommJobs[0]!.provenance,
        sourceId: 'src-ziprecruiter',
        sourceType: 'json_api',
        sourceUrl: 'https://www.ziprecruiter.com/jobs/dup-qualcomm',
      },
    };

    const allVacancies: UnifiedVacancy[] = [
      ...qualcommJobs,
      ...snapJobs,
      ...sonyJobs,
      ...breezyJobs,
      ...pinpointJobs,
      ...srJobs,
      ...hnJobs,
      ...naukriJobs,
      ...bdjobsJobs,
      ...zipJobs,
      ...glassdoorJobs,
      ...baytJobs,
      duplicateOfQualcomm,
    ];

    expect(allVacancies).toHaveLength(13);

    // Run Deduplication
    const clusters = clusterVacancies(allVacancies);
    // 13 items with 1 exact duplicate -> 12 unique clusters
    expect(clusters).toHaveLength(12);

    const qualcommCluster = clusters.find((c) => c.canonicalCompany === 'Qualcomm');
    expect(qualcommCluster).toBeDefined();
    expect(qualcommCluster?.vacanciesCount).toBeGreaterThanOrEqual(2);
    expect(qualcommCluster?.sources.length).toBeGreaterThanOrEqual(2);

    // Verify LinkedIn-Style Template Projection and Catalog Page Integration
    for (const cluster of clusters) {
      const matchingVacancy = allVacancies.find((v) => v.company === cluster.canonicalCompany)!;
      const rendered = renderUnifiedVacancyView(matchingVacancy, 'linkedin-v1');
      expect(rendered).toContain(`# ${matchingVacancy.title}`);
      expect(rendered).toContain(`**${matchingVacancy.company}**`);
      // Equal opportunity boilerplate must be stripped
      expect(rendered).not.toContain('equal opportunity employer');
      expect(rendered).not.toContain('affirmative action');

      // Test catalog document rendering
      const detail = buildVacancyDetail(cluster, cluster.descriptionSummary, matchingVacancy);
      expect(detail).not.toBeNull();
      if (detail) {
        const html = renderVacancyDocument(detail);
        expect(html).toContain('<!doctype html>');
        expect(html).toContain(cluster.canonicalTitle);
        expect(html).toContain(cluster.canonicalCompany);
        expect(html).toContain('application/ld+json');
      }
    }
  });
});
