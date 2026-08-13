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
    id: 'remotive',
    name: 'Remotive',
    market: 'Международный remote',
    transport: 'public_api',
    searchCoverage: 'Совпадения в общей выборке до 50 remote-вакансий; задержка источника до 24 часов',
    attributionUrl: 'https://remotive.com/',
    documentationUrl: 'https://remotive.com/remote-jobs/api',
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
