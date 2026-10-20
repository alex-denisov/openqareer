import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../appTestHarness';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { buildVacancyDetail } from './vacancyCatalogPage';

function sampleCluster(overrides: Partial<VacancyCluster> = {}): VacancyCluster {
  return {
    id: 'ats-greenhouse:cluster-42',
    canonicalTitle: 'Senior Platform Engineer',
    canonicalCompany: 'OpenTelemetry Systems',
    canonicalLocation: 'Berlin, Germany',
    isRemote: false,
    descriptionSummary: 'Разработка высоконагруженной распределенной платформы телеметрии.',
    skills: ['Go', 'Kubernetes', 'gRPC'],
    primaryUrl: 'https://boards.greenhouse.io/opentelemetry/jobs/42',
    sources: [
      {
        sourceType: 'json_api',
        sourceId: 'ats-greenhouse',
        sourceUrl: 'https://boards.greenhouse.io/opentelemetry/jobs/42',
        observedAt: '2026-09-10T12:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-09-08T10:00:00.000Z',
    lastSeenAt: '2026-09-14T08:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
    // Salary keeps the card in the indexable set, the only one with JobPosting.
    salary: { from: 90000, to: 110000, currency: 'EUR' },
    ...overrides,
  };
}

describe('B227: аудит разметки Google for Jobs (Schema.org JobPosting)', () => {
  // Fixture dates are fresh at this moment: posted 6 days ago, seen 4 h ago.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T12:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('формирует обязательные поля JobPosting согласно спецификации Google for Jobs', () => {
    const cluster = sampleCluster();
    const fullText = 'Полное описание требований, задач и условий вакансии. '.repeat(10);
    const detail = buildVacancyDetail(cluster, fullText);

    expect(detail).not.toBeNull();
    expect(detail!.jsonLd['@context']).toBe('https://schema.org');

    const posting = detail!.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting');
    expect(posting).toBeDefined();

    // 1. Title: непустая строка с названием должности
    expect(typeof posting!.title).toBe('string');
    expect((posting!.title as string).trim().length).toBeGreaterThan(0);
    expect(posting!.title).toBe('Senior Platform Engineer');

    // 2. Description: полный текст описания вакансии без обрезки
    expect(typeof posting!.description).toBe('string');
    expect((posting!.description as string).trim().length).toBeGreaterThan(300);
    expect(posting!.description).toBe(`<p>${fullText.trim()}</p>`);

    // 3. DatePosted: валидная дата в формате ISO 8601 (YYYY-MM-DD)
    expect(typeof posting!.datePosted).toBe('string');
    expect(posting!.datePosted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(posting!.datePosted).toBe('2026-09-08');

    // 4. HiringOrganization: Organization с непустым названием
    expect(posting!.hiringOrganization).toEqual({
      '@type': 'Organization',
      name: 'OpenTelemetry Systems',
    });

    // 5. JobLocation: Place с addressLocality для локальных вакансий
    expect(posting!.jobLocation).toEqual({
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Berlin, Germany',
      },
    });

    // 6. DirectApply: отклик на внешней площадке
    expect(posting!.directApply).toBe(false);

    // 7. Identifier: PropertyValue с пространством имен продукта
    expect(posting!.identifier).toMatchObject({
      '@type': 'PropertyValue',
      name: 'openqareer',
    });
  });

  it('корректно размечает удаленный формат работы (TELECOMMUTE)', () => {
    const remoteCluster = sampleCluster({
      canonicalLocation: undefined,
      isRemote: true,
    });
    const detail = buildVacancyDetail(remoteCluster);
    const posting = detail!.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting');

    expect(posting!.jobLocationType).toBe('TELECOMMUTE');
    expect(posting).not.toHaveProperty('jobLocation');
  });

  it('поддерживает гибридный формат (локация + TELECOMMUTE)', () => {
    const hybridCluster = sampleCluster({
      canonicalLocation: 'Amsterdam, Netherlands',
      isRemote: true,
    });
    const detail = buildVacancyDetail(hybridCluster);
    const posting = detail!.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting');

    expect(posting!.jobLocationType).toBe('TELECOMMUTE');
    expect(posting!.jobLocation).toEqual({
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Amsterdam, Netherlands',
      },
    });
  });

  it('не размечает JobPosting карточку без работодателя и вилки — вместо выдуманных полей', () => {
    const minimalCluster = sampleCluster({
      canonicalCompany: '',
      canonicalLocation: undefined,
      salary: undefined,
      isRemote: false,
    });
    const detail = buildVacancyDetail(minimalCluster);
    const posting = detail!.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting');

    expect(posting).toBeUndefined();
    expect(detail!.indexable).toBe(false);
  });

  it('ставит validThrough через 30 дней после публикации и не выдумывает остальное', () => {
    const detail = buildVacancyDetail(sampleCluster({ canonicalLocation: undefined }));
    const posting = detail!.jsonLd['@graph'].find((node) => node['@type'] === 'JobPosting');
    expect(posting!.validThrough).toBe('2026-10-08T10:00:00.000Z');
    expect(posting).not.toHaveProperty('jobLocation');
    expect(posting).not.toHaveProperty('inLanguage');
  });

  it('возвращает 410 Gone для снятых и несуществующих вакансий во избежание пессимизации в Google', async () => {
    const app = await createApp();

    // Несуществующая или удаленная вакансия
    const response = await app.inject({
      method: 'GET',
      url: '/vacancies/job/non-existent-lead-architect-at-acme-999999',
    });

    // Googlebot требует 410 Gone для немедленного удаления из индекса, а не soft 404 или 200
    expect(response.statusCode).toBe(410);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<!doctype html>');
    expect(response.body).toContain('Вакансия снята');
    expect(response.body).toContain('noindex, follow');
  });
});
