import type { VacancySourceHealth } from '../domain/vacancy';

export type VacancySourceHealthStatus =
  | 'not_checked'
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'official_access_required';

const SOURCE_REGISTRY = [
  {
    id: 'hh',
    name: 'hh.ru',
    market: 'Россия и СНГ',
    transport: 'official_api',
    searchCoverage: 'Полный результат официального поиска в пределах API',
    attributionUrl: 'https://hh.ru/',
    documentationUrl: 'https://api.hh.ru/openapi/redoc',
    reviewedAt: '2026-08-13',
  },
  {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    market: 'Германия и Европа',
    transport: 'public_api',
    searchCoverage: 'Совпадения в ограниченной свежей API-выборке',
    attributionUrl: 'https://www.arbeitnow.com/',
    documentationUrl: 'https://www.arbeitnow.com/blog/job-board-api',
    reviewedAt: '2026-08-13',
  },
] as const;

export function vacancySourceRegistryView(health: VacancySourceHealth[]) {
  const healthBySource = new Map(health.map((item) => [item.source, item]));
  return SOURCE_REGISTRY.map((source) => ({
    ...source,
    health: healthBySource.get(source.id) ?? {
      status: 'not_checked' as const,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      retryAfterAt: null,
      consecutiveFailures: 0,
    },
  }));
}
