import { hhVacancyIdFromUrl } from '../../shared/hhCandidateSession';
import { isHhSource } from '../../shared/hhVacancySource';
import { isShownPlace, sameCompany, sameTitle } from '../domain/applyTarget/sameVacancy';
import type { UnifiedVacancy, VacancyCluster, VacancyProvenance } from '../domain/unifiedVacancy';
import { sourceMemberKey } from './vacancyDeduplicator';

type ReadRecord = (id: string) => UnifiedVacancy | undefined;

const ROW_PREFIX = 'cluster-';

function isHhSourceOfCard(
  cluster: VacancyCluster,
  source: VacancyProvenance,
  read: ReadRecord,
): boolean {
  const key = sourceMemberKey(source);
  const record = key ? read(key) : undefined;
  // Своя запись карточки, которой в пуле уже нет: другой вакансии за ней не стоит.
  if (!record) return key !== undefined && `${ROW_PREFIX}${key}` === cluster.id;
  return (
    record.status === 'active' &&
    sameCompany(cluster.canonicalCompany, record.company) &&
    sameTitle(cluster.canonicalTitle, record.title) &&
    isShownPlace(
      { location: cluster.canonicalLocation, isRemote: cluster.isRemote },
      { location: record.location, isRemote: record.isRemote },
    )
  );
}

/**
 * B787: hh.ru остаётся площадкой отклика, только когда его запись — вакансия карточки: те же
 * компания, должность и место (или обе удалённые). Иначе отклик уходит на собственную запись.
 */
export function withOwnHhSources(cluster: VacancyCluster, read: ReadRecord): VacancyCluster {
  if (cluster.sources.length <= 1 || !cluster.sources.some(isHhSource)) return cluster;
  const sources = cluster.sources.filter(
    (source) => !isHhSource(source) || isHhSourceOfCard(cluster, source, read),
  );
  if (sources.length === cluster.sources.length || sources.length === 0) return cluster;
  const primaryHh = hhVacancyIdFromUrl(cluster.primaryUrl);
  const kept = sources.some((source) => hhVacancyIdFromUrl(source.sourceUrl) === primaryHh);
  const primaryUrl = primaryHh && !kept ? (sources[0]?.sourceUrl ?? '') : cluster.primaryUrl;
  return { ...cluster, sources, primaryUrl, vacanciesCount: sources.length };
}
