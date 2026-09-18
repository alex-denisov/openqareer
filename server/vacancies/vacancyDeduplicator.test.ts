import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import {
  clusterVacancies,
  clusterVacanciesAsync,
  IncrementalClusterBuilder,
  isDuplicateVacancy,
  mergeVacanciesIntoClusters,
} from './vacancyDeduplicator';

describe('Vacancy Deduplication & Clustering', () => {
  const vacancyFromHh: UnifiedVacancy = {
    id: 'hh-101',
    fingerprint: 'fp-101',
    title: 'Senior Backend Go Developer',
    company: 'Fintech Solutions',
    location: 'Москва',
    isRemote: true,
    salary: { from: 300000, to: 450000, currency: 'RUR', gross: true },
    description: 'Ищем опытного Go-разработчика для микросервисов высоконагруженной платформы.',
    requiredSkills: ['Go', 'PostgreSQL', 'Docker', 'Kubernetes'],
    url: 'https://hh.ru/vacancy/101',
    provenance: {
      sourceType: 'hh',
      sourceId: 'hh',
      sourceUrl: 'https://hh.ru/vacancy/101',
      observedAt: '2026-08-18T00:00:00.000Z',
    },
    publishedAt: '2026-08-17T12:00:00.000Z',
    status: 'active',
  };

  const vacancyFromTelegram: UnifiedVacancy = {
    id: 'tg-999',
    fingerprint: 'fp-tg-999',
    title: 'Senior Go Developer',
    company: 'Fintech Solutions LLC',
    location: 'Удалённо',
    isRemote: true,
    description: 'Fintech Solutions ищет Senior Go разработчика в команду микросервисов.',
    requiredSkills: ['Golang', 'PostgreSQL', 'Kafka'],
    url: 'https://t.me/job_feed/999',
    provenance: {
      sourceType: 'telegram',
      sourceId: 'tg-job-feed',
      sourceUrl: 'https://t.me/job_feed/999',
      channelName: 'job_feed',
      observedAt: '2026-08-18T01:00:00.000Z',
    },
    publishedAt: '2026-08-17T14:00:00.000Z',
    status: 'active',
  };

  const unrelatedVacancy: UnifiedVacancy = {
    id: 'remotive-55',
    fingerprint: 'fp-rem-55',
    title: 'Staff Frontend Engineer (React)',
    company: 'Global SaaS Co',
    location: 'Worldwide',
    isRemote: true,
    description: 'Lead our web architecture using React and TypeScript.',
    requiredSkills: ['React', 'TypeScript', 'Next.js'],
    url: 'https://remotive.com/jobs/55',
    provenance: {
      sourceType: 'remotive',
      sourceId: 'remotive',
      sourceUrl: 'https://remotive.com/jobs/55',
      observedAt: '2026-08-18T00:30:00.000Z',
    },
    publishedAt: '2026-08-16T10:00:00.000Z',
    status: 'active',
  };

  it('identifies duplicate vacancies across different channels (hh.ru and Telegram)', () => {
    const isDup = isDuplicateVacancy(vacancyFromHh, vacancyFromTelegram);
    expect(isDup).toBe(true);
  });

  it('correctly distinguishes unrelated vacancies from different companies', () => {
    const isDup = isDuplicateVacancy(vacancyFromHh, unrelatedVacancy);
    expect(isDup).toBe(false);
  });

  it('merges multiple source items into a single unified cluster with combined metadata', () => {
    const clusters = clusterVacancies([vacancyFromHh, vacancyFromTelegram, unrelatedVacancy]);
    expect(clusters).toHaveLength(2);

    const fintechCluster = clusters.find((c) => c.canonicalCompany.includes('Fintech Solutions'));
    expect(fintechCluster).toBeDefined();
    expect(fintechCluster?.vacanciesCount).toBe(2);
    expect(fintechCluster?.sources).toHaveLength(2);
    // hh.ru preferred as primary URL over Telegram channel
    expect(fintechCluster?.primaryUrl).toBe('https://hh.ru/vacancy/101');
    // Skills are merged without duplicates
    expect(fintechCluster?.skills).toContain('PostgreSQL');
    expect(fintechCluster?.skills).toContain('Docker');
    // Salary preserved from the richer source
    expect(fintechCluster?.salary?.from).toBe(300000);
  });

  it('clusterVacanciesAsync yields to event loop and produces identical clusters', async () => {
    const syncClusters = clusterVacancies([vacancyFromHh, vacancyFromTelegram, unrelatedVacancy]);
    const asyncClusters = await clusterVacanciesAsync(
      [vacancyFromHh, vacancyFromTelegram, unrelatedVacancy],
      1,
    );
    expect(asyncClusters).toEqual(syncClusters);
  });
});

describe('Vacancies with no named employer stay apart (B164)', () => {
  const base = {
    location: 'Удалённо',
    isRemote: true,
    requiredSkills: ['React'],
    publishedAt: '2026-08-30T10:00:00.000Z',
    status: 'active' as const,
  };

  const withoutEmployer = (id: string, title: string, description: string): UnifiedVacancy => ({
    ...base,
    id,
    fingerprint: `fp-${id}`,
    title,
    company: '',
    description,
    url: `https://t.me/job_react/${id}`,
    provenance: {
      sourceType: 'telegram',
      sourceId: 'src-tg-react',
      sourceUrl: `https://t.me/job_react/${id}`,
      observedAt: '2026-08-30T12:00:00.000Z',
    },
  });

  const first = withoutEmployer(
    '11',
    'Senior React разработчик',
    'Продуктовая команда, React и TypeScript.',
  );
  const second = withoutEmployer(
    '12',
    'React разработчик',
    'Аутсорс-студия, поддержка витрины на React.',
  );

  it('does not call two different vacancies the same one just because neither names an employer', () => {
    expect(isDuplicateVacancy(first, second)).toBe(false);
  });

  it('gives the candidate two cards, each with one source', () => {
    const clusters = clusterVacancies([first, second]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((cluster) => cluster.vacanciesCount === 1)).toBe(true);
  });
});

describe('B205: Cross-source deduplication across five platforms into one card', () => {
  const atsPostingUrl = 'https://boards.greenhouse.io/miro/jobs/987654';

  const atsVacancy: UnifiedVacancy = {
    id: 'ats-miro-987654',
    fingerprint: 'fp-ats-987654',
    title: 'Senior Frontend Engineer (Design Systems)',
    company: 'Miro',
    location: 'Амстердам, Нидерланды',
    isRemote: true,
    description: 'Lead our core UI design system development using React and WebGL.',
    requiredSkills: ['React', 'TypeScript', 'WebGL', 'Design Systems'],
    url: atsPostingUrl,
    provenance: {
      sourceType: 'json_api',
      sourceId: 'ats_greenhouse_miro',
      sourceName: 'Miro (Greenhouse ATS)',
      sourceUrl: atsPostingUrl,
      observedAt: '2026-09-01T08:00:00.000Z',
    },
    publishedAt: '2026-09-01T08:00:00.000Z',
    status: 'active',
  };

  const remotiveVacancy: UnifiedVacancy = {
    id: 'remotive-miro-ui',
    fingerprint: 'fp-remotive-miro-ui',
    title: 'Senior Frontend Engineer - Design Systems',
    company: 'Miro Inc.',
    location: 'Worldwide',
    isRemote: true,
    salary: { from: 110000, to: 140000, currency: 'EUR', gross: true },
    description: 'Miro is looking for a Senior Frontend Engineer to scale our design systems.',
    requiredSkills: ['React', 'TypeScript'],
    url: 'https://remotive.com/jobs/miro-design-systems',
    provenance: {
      sourceType: 'remotive',
      sourceId: 'remotive',
      sourceName: 'Remotive',
      sourceUrl: 'https://remotive.com/jobs/miro-design-systems',
      observedAt: '2026-09-01T10:00:00.000Z',
    },
    publishedAt: '2026-09-01T09:30:00.000Z',
    status: 'active',
  };

  const remoteOkVacancy: UnifiedVacancy = {
    id: 'remoteok-miro-ds',
    fingerprint: 'fp-remoteok-miro-ds',
    title: 'Senior Frontend Engineer (Design Systems)',
    company: 'Miro',
    location: 'Remote',
    isRemote: true,
    description:
      'Lead our core UI design system development. Direct apply: https://boards.greenhouse.io/miro/jobs/987654',
    requiredSkills: ['React', 'Design Systems'],
    url: 'https://remoteok.com/remote-jobs/miro-senior-frontend-engineer',
    provenance: {
      sourceType: 'json_api',
      sourceId: 'remoteok',
      sourceName: 'RemoteOK',
      sourceUrl: 'https://remoteok.com/remote-jobs/miro-senior-frontend-engineer',
      observedAt: '2026-09-01T11:00:00.000Z',
    },
    publishedAt: '2026-09-01T10:15:00.000Z',
    status: 'active',
  };

  const rssVacancy: UnifiedVacancy = {
    id: 'rss-miro-ds',
    fingerprint: 'fp-rss-miro-ds',
    title: 'Senior Frontend Developer, Design Systems',
    company: 'Miro',
    location: 'Amsterdam / Remote',
    isRemote: true,
    description: 'Core UI engineering role at Miro. Apply via ATS.',
    requiredSkills: ['Frontend', 'React'],
    url: 'https://newsfeed.example/jobs/miro-ds',
    provenance: {
      sourceType: 'rss',
      sourceId: 'rss_europe_tech',
      sourceName: 'EU Tech RSS Feed',
      sourceUrl: 'https://newsfeed.example/jobs/miro-ds',
      observedAt: '2026-09-01T12:00:00.000Z',
    },
    publishedAt: '2026-09-01T11:45:00.000Z',
    status: 'active',
  };

  const telegramVacancy: UnifiedVacancy = {
    id: 'tg-miro-ds',
    fingerprint: 'fp-tg-miro-ds',
    title: 'Senior Frontend Engineer (Design Systems) в Miro',
    company: 'Miro',
    location: 'Амстердам / Удаленно',
    isRemote: true,
    description:
      'Горячая вакансия в Miro: Senior Frontend Engineer (Design Systems). Отклик на ATS: https://boards.greenhouse.io/miro/jobs/987654',
    requiredSkills: ['React', 'TypeScript', 'CSS'],
    url: 'https://t.me/relocation_jobs/7788',
    provenance: {
      sourceType: 'telegram',
      sourceId: 'tg_relocation_jobs',
      sourceName: 'Relocation Jobs TG',
      sourceUrl: 'https://t.me/relocation_jobs/7788',
      observedAt: '2026-09-01T14:00:00.000Z',
    },
    publishedAt: '2026-09-01T13:00:00.000Z',
    status: 'active',
  };

  it('clusters the same vacancy from 5 platforms into a single card', () => {
    const clusters = clusterVacancies([
      telegramVacancy,
      remotiveVacancy,
      atsVacancy,
      remoteOkVacancy,
      rssVacancy,
    ]);

    expect(clusters).toHaveLength(1);
    const card = clusters[0];

    // Vacancies count reflects all 5 platforms
    expect(card.vacanciesCount).toBe(5);

    // Lists all 5 distinct sources
    expect(card.sources).toHaveLength(5);
    const sourceIds = card.sources.map((s) => s.sourceId);
    expect(sourceIds).toContain('ats_greenhouse_miro');
    expect(sourceIds).toContain('remotive');
    expect(sourceIds).toContain('remoteok');
    expect(sourceIds).toContain('rss_europe_tech');
    expect(sourceIds).toContain('tg_relocation_jobs');

    // Direct employer ATS is chosen as canonical primaryUrl over aggregators/channels
    expect(card.primaryUrl).toBe(atsPostingUrl);
    expect(card.canonicalCompany).toBe('Miro');

    // Salary enriched from Remotive
    expect(card.salary?.from).toBe(110000);
    expect(card.salary?.currency).toBe('EUR');

    // Location keeps the specific city over generic "Worldwide"
    expect(card.canonicalLocation).toContain('Амстердам');

    // Skills merged from all platforms
    expect(card.skills).toContain('WebGL');
    expect(card.skills).toContain('Design Systems');
  });

  it('calculates reprint and authenticity share per source for B200', async () => {
    const { calculateSourceAuthenticity } = await import('./vacancyDeduplicator');
    const clusters = clusterVacancies([
      atsVacancy,
      remotiveVacancy,
      remoteOkVacancy,
      rssVacancy,
      telegramVacancy,
    ]);

    // ATS is the original direct employer: 1 original, 0 reprints
    const atsAuth = calculateSourceAuthenticity('ats_greenhouse_miro', clusters);
    expect(atsAuth.originalShare).toEqual({ counted: 1, of: 1 });
    expect(atsAuth.reprintShare).toEqual({ counted: 0, of: 1 });

    // Remotive reprinted from employer ATS: 0 original, 1 reprint
    const remotiveAuth = calculateSourceAuthenticity('remotive', clusters);
    expect(remotiveAuth.originalShare).toEqual({ counted: 0, of: 1 });
    expect(remotiveAuth.reprintShare).toEqual({ counted: 1, of: 1 });

    // Telegram reprinted: 0 original, 1 reprint
    const tgAuth = calculateSourceAuthenticity('tg_relocation_jobs', clusters);
    expect(tgAuth.originalShare).toEqual({ counted: 0, of: 1 });
    expect(tgAuth.reprintShare).toEqual({ counted: 1, of: 1 });
  });

  describe('Incremental clustering (B221 slice 3)', () => {
    const vHh: UnifiedVacancy = {
      id: 'hh-101',
      fingerprint: 'fp-101',
      title: 'Senior Backend Go Developer',
      company: 'Fintech Solutions',
      location: 'Москва',
      isRemote: true,
      salary: { from: 300000, to: 450000, currency: 'RUR', gross: true },
      description: 'Go dev',
      requiredSkills: ['Go', 'PostgreSQL'],
      url: 'https://hh.ru/vacancy/101',
      provenance: {
        sourceType: 'hh',
        sourceId: 'hh',
        sourceUrl: 'https://hh.ru/vacancy/101',
        observedAt: '2026-08-18T00:00:00.000Z',
      },
      publishedAt: '2026-08-17T12:00:00.000Z',
      status: 'active',
    };

    const vTg: UnifiedVacancy = {
      id: 'tg-999',
      fingerprint: 'fp-tg-999',
      title: 'Senior Go Developer',
      company: 'Fintech Solutions LLC',
      location: 'Удалённо',
      isRemote: true,
      description: 'Go dev in telegram',
      requiredSkills: ['Golang', 'PostgreSQL', 'Kafka'],
      url: 'https://t.me/job_feed/999',
      provenance: {
        sourceType: 'telegram',
        sourceId: 'tg-job-feed',
        sourceUrl: 'https://t.me/job_feed/999',
        channelName: 'job_feed',
        observedAt: '2026-08-18T01:00:00.000Z',
      },
      publishedAt: '2026-08-17T14:00:00.000Z',
      status: 'active',
    };

    const vUnrelated: UnifiedVacancy = {
      id: 'remotive-55',
      fingerprint: 'fp-rem-55',
      title: 'Staff Frontend Engineer (React)',
      company: 'Global SaaS Co',
      location: 'Worldwide',
      isRemote: true,
      description: 'Lead React',
      requiredSkills: ['React', 'TypeScript'],
      url: 'https://remotive.com/jobs/55',
      provenance: {
        sourceType: 'remotive',
        sourceId: 'remotive',
        sourceUrl: 'https://remotive.com/jobs/55',
        observedAt: '2026-08-18T00:30:00.000Z',
      },
      publishedAt: '2026-08-16T10:00:00.000Z',
      status: 'active',
    };

    it('merges new vacancies into existing clusters or creates new clusters', () => {
      const existingCluster: VacancyCluster = {
        id: 'cluster-hh-101',
        canonicalTitle: 'Senior Backend Go Developer',
        canonicalCompany: 'Fintech Solutions',
        canonicalLocation: 'Москва',
        isRemote: true,
        salary: { from: 300000, to: 450000, currency: 'RUR', gross: true },
        descriptionSummary: 'Go-разработчик',
        skills: ['Go', 'PostgreSQL'],
        primaryUrl: 'https://hh.ru/vacancy/101',
        sources: [
          {
            sourceType: 'hh',
            sourceId: 'hh',
            sourceUrl: 'https://hh.ru/vacancy/101',
            observedAt: '2026-08-18T00:00:00.000Z',
          },
        ],
        firstObservedAt: '2026-08-17T12:00:00.000Z',
        lastSeenAt: '2026-08-18T00:00:00.000Z',
        status: 'active',
        vacanciesCount: 1,
      };

      const builder = new IncrementalClusterBuilder([existingCluster]);
      expect(builder.getClusters()).toHaveLength(1);

      // vTg duplicates existingCluster, vUnrelated creates a new cluster
      const result = builder.addVacancies([vTg, vUnrelated]);

      expect(result.updatedClusters).toHaveLength(1);
      expect(result.updatedClusters[0].id).toBe('cluster-hh-101');
      expect(result.updatedClusters[0].vacanciesCount).toBe(2);
      expect(result.updatedClusters[0].skills).toContain('Kafka');

      expect(result.newClusters).toHaveLength(1);
      expect(result.newClusters[0].canonicalCompany).toBe('Global SaaS Co');

      expect(builder.getClusters()).toHaveLength(2);
    });

    it('mergeVacanciesIntoClusters helper matches IncrementalClusterBuilder', () => {
      const clusters: VacancyCluster[] = [];
      const result = mergeVacanciesIntoClusters(clusters, [vHh, vTg]);

      expect(result.newClusters).toHaveLength(1);
      expect(result.newClusters[0].vacanciesCount).toBe(2);
      expect(clusters).toHaveLength(1);
    });

    it('replaces a re-observation with the same vacancy id instead of merging stale fields', () => {
      const first = {
        ...vHh,
        id: 'stable-id',
        fingerprint: 'stable-fingerprint',
        title: 'Backend Engineer',
        description: 'Original description',
        requiredSkills: ['TypeScript'],
      };
      const edited = {
        ...first,
        fingerprint: 'edited-fingerprint',
        title: 'Director of Finance',
        description: 'Edited description',
        requiredSkills: ['Excel'],
        url: 'https://hh.ru/vacancy/stable-id-edited',
        provenance: { ...first.provenance, sourceUrl: 'https://hh.ru/vacancy/stable-id-edited' },
      };

      const clusters: VacancyCluster[] = [];
      mergeVacanciesIntoClusters(clusters, [first]);
      mergeVacanciesIntoClusters(clusters, [edited]);

      expect(clusters).toHaveLength(1);
      expect(clusters[0]?.vacanciesCount).toBe(1);
      expect(clusters[0]?.canonicalTitle).toBe('Director of Finance');
      expect(clusters[0]?.descriptionSummary).toBe('Edited description');
      expect(clusters[0]?.skills).toEqual(['Excel']);
    });

    it('does not grow index buckets for repeated observations', () => {
      const repeated = Array.from({ length: 100 }, () => vHh);
      const clusters: VacancyCluster[] = [];
      const builder = new IncrementalClusterBuilder(clusters);
      builder.addVacancies(repeated);

      const index = (builder as unknown as { index: { byUrl: Map<string, number[]> } }).index;
      expect(index.byUrl.get(vHh.url)).toHaveLength(1);
      expect(builder.getClusters()[0]?.vacanciesCount).toBe(1);
    });
  });
});
