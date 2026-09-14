import { describe, expect, it } from 'vitest';
import {
  ATS_PROVIDERS,
  atsBoardEndpoint,
  atsBoardSourceId,
  normalizeAtsBoard,
  parseAtsBoardSourceId,
} from './atsBoardAdapters';

/**
 * B202 — формы записей взяты из живых ответов 2026-09-05 с маршрута eu-prod
 * (таблица замеров в тикете), обрезаны до полей, которые читает адаптер.
 */
const OBSERVED_AT = '2026-09-05T18:00:00.000Z';

describe('ats board source id', () => {
  it('строит и разбирает идентификатор доски', () => {
    const id = atsBoardSourceId('greenhouse', 'figma');
    expect(id).toBe('ats-greenhouse-figma');
    expect(parseAtsBoardSourceId(id)).toEqual({ provider: 'greenhouse', board: 'figma' });
  });

  it('разбирает слаг с дефисами и отказывает чужому идентификатору', () => {
    expect(parseAtsBoardSourceId('ats-lever-nova-labs')).toEqual({
      provider: 'lever',
      board: 'nova-labs',
    });
    expect(parseAtsBoardSourceId('src-remoteok')).toBeNull();
    expect(parseAtsBoardSourceId('ats-hh-figma')).toBeNull();
  });

  it('строит адрес каждой доски по замеренному образцу', () => {
    expect(atsBoardEndpoint('greenhouse', 'figma')).toBe(
      'https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true',
    );
    expect(atsBoardEndpoint('lever', 'ledger')).toBe(
      'https://api.lever.co/v0/postings/ledger?mode=json',
    );
    expect(atsBoardEndpoint('ashby', 'ramp')).toBe(
      'https://api.ashbyhq.com/posting-api/job-board/ramp',
    );
    expect(atsBoardEndpoint('workable', 'zego')).toBe(
      'https://apply.workable.com/api/v1/widget/accounts/zego?details=true',
    );
    expect(atsBoardEndpoint('recruitee', 'hygraph')).toBe(
      'https://hygraph.recruitee.com/api/offers/',
    );
    expect(atsBoardEndpoint('smartrecruiters', 'BoschGroup')).toBe(
      'https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100',
    );
    expect(atsBoardEndpoint('breezy', 'joom-group')).toBe(
      'https://joom-group.breezy.hr/json',
    );
    expect(atsBoardEndpoint('pinpoint', 'pinpoint')).toBe(
      'https://pinpoint.pinpointhq.com/postings.json',
    );
  });

  it('разрешает SmartRecruiters, Breezy HR и Pinpoint в контрактах', () => {
    const smart = ATS_PROVIDERS.find((p) => p.provider === 'smartrecruiters');
    expect(smart?.crawlPermission).toBe('allowed');
    expect(smart?.robotsNote).toContain('robotsOverride');
    const breezy = ATS_PROVIDERS.find((p) => p.provider === 'breezy');
    expect(breezy?.crawlPermission).toBe('allowed');
    const pinpoint = ATS_PROVIDERS.find((p) => p.provider === 'pinpoint');
    expect(pinpoint?.crawlPermission).toBe('allowed');
    expect(ATS_PROVIDERS.filter((p) => p.crawlPermission === 'allowed').map((p) => p.provider)).toEqual(
      ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'smartrecruiters', 'breezy', 'pinpoint'],
    );
  });
});

describe('ats board adapters', () => {
  it('читает запись Greenhouse вместе с названием работодателя из ленты', () => {
    const [vacancy] = normalizeAtsBoard('ats-greenhouse-figma', {
      jobs: [
        {
          id: 5364702004,
          absolute_url: 'https://boards.greenhouse.io/figma/jobs/5364702004?gh_jid=5364702004',
          title: 'Account Executive (Berlin, Germany)',
          company_name: 'Figma',
          location: { name: 'Berlin, Germany' },
          content: '&lt;p&gt;Figma is growing&lt;/p&gt;',
          first_published: '2026-08-01T06:05:10-04:00',
          departments: [{ name: 'Sales' }],
        },
      ],
    }, { observedAt: OBSERVED_AT, sourceName: 'Figma' });

    expect(vacancy).toMatchObject({
      title: 'Account Executive (Berlin, Germany)',
      company: 'Figma',
      location: 'Berlin, Germany',
      url: 'https://boards.greenhouse.io/figma/jobs/5364702004?gh_jid=5364702004',
      status: 'active',
    });
    expect(vacancy?.description).toContain('Figma is growing');
    expect(vacancy?.provenance).toMatchObject({
      sourceId: 'ats-greenhouse-figma',
      sourceType: 'json_api',
      externalId: '5364702004',
      observedAt: OBSERVED_AT,
    });
    expect(vacancy?.publishedAt).toBe(new Date('2026-08-01T06:05:10-04:00').toISOString());
  });

  it('берёт работодателя Lever из реестра: лента его не публикует', () => {
    const [vacancy] = normalizeAtsBoard('ats-lever-ledger', [
      {
        id: '9377374f-771b-476a-93a6-bfdb795629fa',
        text: 'Local Market Outreach - Australia',
        categories: { location: 'Sydney, Australia', commitment: 'Contractor / Freelance' },
        workplaceType: 'remote',
        descriptionPlain: 'Since 2014, Ledger has been building',
        createdAt: 1746452423978,
        hostedUrl: 'https://jobs.lever.co/ledger/9377374f-771b-476a-93a6-bfdb795629fa',
        salaryRange: { min: 90000, max: 120000, currency: 'AUD' },
      },
    ], { observedAt: OBSERVED_AT, sourceName: 'Ledger' });

    expect(vacancy).toMatchObject({
      title: 'Local Market Outreach - Australia',
      company: 'Ledger',
      location: 'Sydney, Australia',
      isRemote: true,
      employmentType: 'Contractor / Freelance',
      url: 'https://jobs.lever.co/ledger/9377374f-771b-476a-93a6-bfdb795629fa',
    });
    expect(vacancy?.salary).toEqual({ from: 90000, to: 120000, currency: 'AUD' });
    expect(vacancy?.publishedAt).toBe(new Date(1746452423978).toISOString());
  });

  it('читает запись Ashby с настоящей датой публикации', () => {
    const [vacancy] = normalizeAtsBoard('ats-ashby-ramp', {
      jobs: [
        {
          id: '34413f8d-26bf-4bbc-8ade-eb309a0e2245',
          title: 'Security Engineer, Cloud',
          location: 'New York, NY (HQ)',
          employmentType: 'FullTime',
          publishedAt: '2026-04-07T17:12:35.753+00:00',
          isRemote: true,
          jobUrl: 'https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245',
          descriptionPlain: 'ABOUT RAMP',
        },
      ],
    }, { observedAt: OBSERVED_AT, sourceName: 'Ramp' });

    expect(vacancy).toMatchObject({
      title: 'Security Engineer, Cloud',
      company: 'Ramp',
      isRemote: true,
      employmentType: 'FullTime',
      url: 'https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245',
    });
    expect(vacancy?.publishedAt).toBe(new Date('2026-04-07T17:12:35.753+00:00').toISOString());
  });

  it('читает запись Workable вместе с именем аккаунта', () => {
    const [vacancy] = normalizeAtsBoard('ats-workable-zego', {
      name: 'Zego',
      jobs: [
        {
          title: 'Analytics Engineer',
          shortcode: 'B76C11B977',
          employment_type: 'Full-time',
          telecommuting: false,
          url: 'https://apply.workable.com/j/B76C11B977',
          published_on: '2026-07-10',
          country: 'United Kingdom',
          city: 'London',
          experience: 'Mid-Senior level',
          description: '<p><strong>About Zego</strong></p>',
        },
      ],
    }, { observedAt: OBSERVED_AT, sourceName: 'Zego' });

    expect(vacancy).toMatchObject({
      title: 'Analytics Engineer',
      company: 'Zego',
      location: 'London, United Kingdom',
      isRemote: false,
      experienceLevel: 'Mid-Senior level',
      url: 'https://apply.workable.com/j/B76C11B977',
    });
    expect(vacancy?.publishedAt).toBe(new Date('2026-07-10').toISOString());
  });

  it('читает запись Recruitee с зарплатой и публичной ссылкой', () => {
    const [vacancy] = normalizeAtsBoard('ats-recruitee-hygraph', {
      offers: [
        {
          id: 2697184,
          title: 'Partner Development Representative',
          company_name: 'Hygraph',
          location: 'Berlin, Berlin, Germany',
          remote: false,
          published_at: '2026-07-31 22:26:40 UTC',
          careers_url: 'https://jobs.hygraph.com/o/partner-development-representative',
          description: '<p>How you will make an impact</p>',
          salary: { min: '75000', max: '90000', currency: 'EUR' },
          employment_type_code: 'fulltime_permanent',
          department: 'Sales',
        },
      ],
    }, { observedAt: OBSERVED_AT, sourceName: 'Hygraph' });

    expect(vacancy).toMatchObject({
      title: 'Partner Development Representative',
      company: 'Hygraph',
      location: 'Berlin, Berlin, Germany',
      url: 'https://jobs.hygraph.com/o/partner-development-representative',
    });
    expect(vacancy?.salary).toEqual({ from: 75000, to: 90000, currency: 'EUR' });
    expect(vacancy?.publishedAt).toBe(new Date('2026-07-31T22:26:40Z').toISOString());
  });

  it('строит публичную ссылку SmartRecruiters, которой нет в записи', () => {
    const [vacancy] = normalizeAtsBoard('ats-smartrecruiters-BoschGroup', {
      content: [
        {
          id: '744000147640279',
          name: 'SAP MDM Consultant',
          company: { identifier: 'BoschGroup', name: 'Bosch Group' },
          releasedDate: '2026-09-05T11:32:05.117Z',
          location: { city: 'bangalore', country: 'in', fullLocation: 'bangalore, , India', remote: false },
          typeOfEmployment: { label: 'Full-time' },
          experienceLevel: { label: 'Associate' },
        },
      ],
    }, { observedAt: OBSERVED_AT, sourceName: 'Bosch Group' });

    expect(vacancy).toMatchObject({
      title: 'SAP MDM Consultant',
      company: 'Bosch Group',
      location: 'bangalore, , India',
      url: 'https://jobs.smartrecruiters.com/BoschGroup/744000147640279',
      employmentType: 'Full-time',
      experienceLevel: 'Associate',
    });
  });

  it('читает запись Breezy HR из массива объектов', () => {
    const [vacancy] = normalizeAtsBoard('ats-breezy-joom-group', [
      {
        id: 'c87413d0a10b',
        name: 'Senior Frontend Engineer',
        url: 'https://joom-group.breezy.hr/p/c87413d0a10b-senior-frontend-engineer',
        department: 'Engineering',
        location: {
          name: 'Berlin, Germany',
          is_remote: true,
        },
        type: {
          id: 'full_time',
          name: 'Full-Time',
        },
        description: '<p>Join Joom as Senior Frontend Engineer</p>',
      },
    ], { observedAt: OBSERVED_AT, sourceName: 'Joom' });

    expect(vacancy).toMatchObject({
      title: 'Senior Frontend Engineer',
      company: 'Joom',
      location: 'Berlin, Germany',
      isRemote: true,
      employmentType: 'Full-Time',
      url: 'https://joom-group.breezy.hr/p/c87413d0a10b-senior-frontend-engineer',
      status: 'active',
    });
    expect(vacancy?.provenance).toMatchObject({
      sourceId: 'ats-breezy-joom-group',
      sourceType: 'json_api',
      externalId: 'c87413d0a10b',
      observedAt: OBSERVED_AT,
    });
  });

  it('читает объект с полем data от Pinpoint', () => {
    const [vacancy] = normalizeAtsBoard('ats-pinpoint-pinpoint', {
      data: [
        {
          id: '12345',
          title: 'Senior Backend Engineer (Go)',
          url: 'https://pinpoint.pinpointhq.com/postings/12345',
          department: 'Product & Engineering',
          location: 'London, United Kingdom',
        },
      ],
    }, { observedAt: OBSERVED_AT, sourceName: 'Pinpoint' });

    expect(vacancy).toMatchObject({
      title: 'Senior Backend Engineer (Go)',
      company: 'Pinpoint',
      location: 'London, United Kingdom',
      url: 'https://pinpoint.pinpointhq.com/postings/12345',
      status: 'active',
    });
    expect(vacancy?.provenance).toMatchObject({
      sourceId: 'ats-pinpoint-pinpoint',
      sourceType: 'json_api',
      externalId: '12345',
      observedAt: OBSERVED_AT,
    });
  });

  it('читает массив вакансий от Pinpoint', () => {
    const [vacancy] = normalizeAtsBoard('ats-pinpoint-pinpoint', [
      {
        id: '67890',
        title: 'Platform Engineer',
        url: 'https://pinpoint.pinpointhq.com/postings/67890',
        department: 'Infrastructure',
        location: {
          name: 'Remote, UK',
          city: 'London',
          country: 'United Kingdom',
        },
      },
    ], { observedAt: OBSERVED_AT, sourceName: 'Pinpoint' });

    expect(vacancy).toMatchObject({
      title: 'Platform Engineer',
      company: 'Pinpoint',
      location: 'Remote, UK',
      isRemote: true,
      url: 'https://pinpoint.pinpointhq.com/postings/67890',
      status: 'active',
    });
  });

  it('нечитаемый ответ доски падает, а не выдаёт пустой успешный улов', () => {
    expect(() =>
      normalizeAtsBoard('ats-greenhouse-figma', { error: 'not found' }, {
        observedAt: OBSERVED_AT,
        sourceName: 'Figma',
      }),
    ).toThrow(/unreadable/);
    expect(() =>
      normalizeAtsBoard('ats-lever-ledger', { ok: false }, {
        observedAt: OBSERVED_AT,
        sourceName: 'Ledger',
      }),
    ).toThrow(/unreadable/);
  });

  it('живая доска без вакансий — пустой улов, а не отказ', () => {
    expect(
      normalizeAtsBoard('ats-workable-bolt', { name: 'Bolt', jobs: [] }, {
        observedAt: OBSERVED_AT,
        sourceName: 'Bolt',
      }),
    ).toEqual([]);
  });
});
