import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import {
  createClusterFromVacancy,
  mergeVacancyIntoCluster,
  sourceMemberKey,
} from './vacancyDeduplicator';
import { normalizeTextForComparison } from './vacancyFingerprint';

/**
 * Кластер, склеенный голым внешним id до B752, называет вакансию чужим именем (24.11: «ЭР-Телеком,
 * Head of DevOps» getmatch:37138 стал «Receptionist» icims:37138). Такой кластер не разбивается, пока
 * на него ссылается отклик, поэтому чтение по id сверяет его с самой записью.
 */

/** Столько источников читаются по одному при сборке кластера из записей. */
const REBUILD_SOURCES_MAX = 30;

/** Один внешний id у двух площадок — единственный след склейки голым id. */
export function hasCrossSourceIdCollision(cluster: VacancyCluster): boolean {
  const sourcesByExternalId = new Map<string, string>();
  for (const source of cluster.sources) {
    if (!source.externalId) continue;
    const seen = sourcesByExternalId.get(source.externalId);
    if (seen !== undefined && seen !== source.sourceId) return true;
    sourcesByExternalId.set(source.externalId, source.sourceId);
  }
  return false;
}

const words = (title: string) =>
  normalizeTextForComparison(title)
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean)
    .join(' ');

/** Одно название: совпадает пословно или одно продолжает другое («CTO» и «CTO, Acme»). */
export function sameVacancyTitle(a: string, b: string): boolean {
  const left = words(a);
  const right = words(b);
  if (!left || !right) return false;
  return left === right || ` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `);
}

type ReadRecord = (id: string) => UnifiedVacancy | undefined;

function rebuildAround(
  record: UnifiedVacancy,
  cluster: VacancyCluster,
  read: ReadRecord,
): VacancyCluster {
  const own = createClusterFromVacancy(record);
  const company = words(record.company ?? '');
  if (!company) return own;
  for (const source of cluster.sources.slice(0, REBUILD_SOURCES_MAX)) {
    const id = sourceMemberKey(source);
    const member = id && id !== record.id ? read(id) : undefined;
    if (
      member?.status === 'active' &&
      words(member.title) === words(record.title) &&
      words(member.company ?? '') === company
    ) {
      mergeVacancyIntoCluster(own, member);
    }
  }
  return own;
}

/**
 * Кластер для записи `recordId`: сохранённый, если он про неё, иначе собранный из самой записи и её
 * двойников с тем же названием у той же компании. Снятая запись чужой вакансией не подменяется.
 */
export function clusterOfRecord(
  cluster: VacancyCluster,
  recordId: string,
  read: ReadRecord,
  readAny: ReadRecord = read,
): VacancyCluster | undefined {
  const record = readAny(recordId);
  const collided = hasCrossSourceIdCollision(cluster);
  if (!record) return collided ? undefined : cluster;
  if (!collided && sameVacancyTitle(record.title, cluster.canonicalTitle)) return cluster;
  const live = read(recordId);
  return live?.status === 'active' ? rebuildAround(live, cluster, read) : undefined;
}
