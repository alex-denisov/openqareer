import type { VacancyCluster, VacancyProvenance } from '../domain/unifiedVacancy';
import { hhVacancyIdFromUrl } from '../../shared/hhCandidateSession';

/**
 * B787: пока отклик уходит через hh.ru, его цель не меняется: пересчёт склейки или выкатка
 * посреди отправки не уводят ту же карточку на другую площадку.
 */
export function withHhAttempt(cluster: VacancyCluster, hhVacancyId: string | null): VacancyCluster {
  if (!hhVacancyId) return cluster;
  const isHeld = (source: VacancyProvenance) =>
    hhVacancyIdFromUrl(source.sourceUrl) === hhVacancyId;
  const held = cluster.sources.find(isHeld) ?? {
    sourceType: 'json_api' as const,
    sourceId: 'src-hh-search',
    sourceName: 'hh.ru',
    externalId: hhVacancyId,
    sourceUrl: `https://hh.ru/vacancy/${hhVacancyId}`,
    observedAt: new Date().toISOString(),
  };
  const sources = [held, ...cluster.sources.filter((source) => !isHeld(source))];
  return { ...cluster, sources, vacanciesCount: sources.length };
}
