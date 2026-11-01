import type { VacancyCluster } from '../domain/unifiedVacancy';

/**
 * Кластер после ухода вакансий (01.11): снятый не трогается повторно, ушедший источник
 * убирается, поэтому повторная весть о той же вакансии не вычитает её второй раз.
 */
export function expireClusterSources(
  cluster: VacancyCluster,
  goneSet: ReadonlySet<string>,
): VacancyCluster {
  if (cluster.status === 'archived') return cluster;
  const isGone = (s: VacancyCluster['sources'][number]) =>
    Boolean(
      (s.externalId && goneSet.has(s.externalId)) || (s.sourceUrl && goneSet.has(s.sourceUrl)),
    );
  const byId = goneSet.has(cluster.id.replace(/^cluster-/, ''));
  const remaining = cluster.sources.filter((s) => !isGone(s));
  const gone = cluster.sources.length - remaining.length;
  if (gone === 0 && !byId) return cluster;
  const count = cluster.vacanciesCount - Math.max(1, gone);
  return count <= 0
    ? { ...cluster, status: 'archived' }
    : { ...cluster, vacanciesCount: count, sources: remaining };
}
