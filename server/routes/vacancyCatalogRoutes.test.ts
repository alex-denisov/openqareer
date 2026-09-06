import { describe, expect, it } from 'vitest';
import { buildCatalogSitemap } from './vacancyCatalogRoutes';
import type { VacancyCluster } from '../domain/unifiedVacancy';

function cluster(overrides: Partial<VacancyCluster> = {}): VacancyCluster {
  return {
    id: 'board-1:cluster-1',
    canonicalTitle: 'Director, Privacy Legal',
    canonicalCompany: 'Reddit',
    canonicalLocation: 'San Francisco, USA',
    isRemote: false,
    descriptionSummary: 'Ищем директора.',
    skills: [],
    primaryUrl: 'https://boards.greenhouse.io/reddit/jobs/1',
    sources: [
      {
        sourceType: 'json_api',
        sourceId: 'ats-reddit',
        sourceUrl: 'https://boards.greenhouse.io/reddit/jobs/1',
        observedAt: '2026-09-06T00:00:00.000Z',
      },
    ],
    firstObservedAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: '2026-09-06T00:00:00.000Z',
    status: 'active',
    vacanciesCount: 1,
    ...overrides,
  };
}

describe('карта сайта с каталогом (B209)', () => {
  it('перечисляет постоянные страницы, страницы каталога и живые вакансии', () => {
    const sitemap = buildCatalogSitemap([cluster()]);

    expect(sitemap).toContain('<loc>https://openqareer.com/</loc>');
    expect(sitemap).toContain('<loc>https://openqareer.com/legal/privacy</loc>');
    expect(sitemap).toContain('<loc>https://openqareer.com/vacancies</loc>');
    expect(sitemap).toMatch(/<loc>https:\/\/openqareer\.com\/vacancies\/job\/director-privacy-legal-at-reddit-[a-z0-9]+<\/loc>/u);
  });

  it('не перечисляет вакансию, которой правило адресов не даёт адреса', () => {
    const sitemap = buildCatalogSitemap([cluster({ canonicalTitle: 'Специалист по щебню' })]);
    expect(sitemap).not.toContain('/vacancies/job/');
  });

  it('перечисляет страницы каталога, когда вакансий больше одной страницы', () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      cluster({ id: `c${index}`, canonicalTitle: `Data Analyst ${index}` }),
    );
    const sitemap = buildCatalogSitemap(many);
    expect(sitemap).toContain('<loc>https://openqareer.com/vacancies/page/2</loc>');
    expect(sitemap).toContain('<loc>https://openqareer.com/vacancies/page/3</loc>');
  });

  it('остаётся правильным XML и держится в пределах лимита карты сайта', () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      cluster({ id: `c${index}`, canonicalTitle: `Data Analyst ${index}` }),
    );
    const sitemap = buildCatalogSitemap(many);
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(sitemap.trimEnd().endsWith('</urlset>')).toBe(true);
    expect((sitemap.match(/<url>/gu) ?? []).length).toBeLessThanOrEqual(50_000);
  });

  it('каждый адрес в карте сайта отвечает правилу адресов владельца', async () => {
    const { publicPathViolation } = await import('../../shared/seoSlugPolicy');
    const sitemap = buildCatalogSitemap([cluster()]);
    for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)) {
      expect(publicPathViolation(new URL(match[1]).pathname)).toBeNull();
    }
  });
});
