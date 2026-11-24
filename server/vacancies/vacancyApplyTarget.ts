import type { ApplyTarget } from '../../shared/applyTarget';
import { applyAddress } from '../domain/applyTarget/applyAddress';
import { resolveApplyTarget } from '../domain/applyTarget/applyTarget';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import type { RouteDeps } from '../routes/deps';
import { sourceMemberKey } from './vacancyDeduplicator';

const ROW_PREFIX = 'cluster-';
/** Столько источников читается точечно: дольше — заведомо ложная склейка. */
const MAX_MEMBERS = 30;

/** Цель отклика для строки подборки: запись самой строки и её источники в пуле. */
export function resolveVacancyApplyTarget(
  engine: Pick<RouteDeps['multiSourceEngine'], 'getVacancy'>,
  cluster: VacancyCluster,
  redirected?: (url: string) => string | undefined,
): ApplyTarget | null {
  const read = (id: string): UnifiedVacancy | undefined => engine.getVacancy?.(id);
  const own = cluster.id.startsWith(ROW_PREFIX)
    ? read(cluster.id.slice(ROW_PREFIX.length))
    : read(cluster.id);
  // Записи нет: известен только адрес кластера, сверять двойников не с чем.
  if (!own) {
    const known = applyAddress(cluster.primaryUrl);
    return known && { ...known, origin: 'url' };
  }
  const members = cluster.sources.slice(0, MAX_MEMBERS).flatMap((source) => {
    const id = sourceMemberKey(source);
    const member = id && id !== own.id ? read(id) : undefined;
    return member ? [member] : [];
  });
  return resolveApplyTarget({ vacancy: own, members, redirected });
}
