import { describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { clusterVacancies, isDuplicateVacancy } from './vacancyDeduplicator';

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

  const first = withoutEmployer('11', 'Senior React разработчик', 'Продуктовая команда, React и TypeScript.');
  const second = withoutEmployer('12', 'React разработчик', 'Аутсорс-студия, поддержка витрины на React.');

  it('does not call two different vacancies the same one just because neither names an employer', () => {
    expect(isDuplicateVacancy(first, second)).toBe(false);
  });

  it('gives the candidate two cards, each with one source', () => {
    const clusters = clusterVacancies([first, second]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((cluster) => cluster.vacanciesCount === 1)).toBe(true);
  });
});
