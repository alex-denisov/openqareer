import type { ApplyTarget } from '../../shared/applyTarget';
import { applyAddress } from '../domain/applyTarget/applyAddress';
import { resolveApplyTarget } from '../domain/applyTarget/applyTarget';
import { isShownPosting } from '../domain/applyTarget/sameVacancy';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import type { RouteDeps } from '../routes/deps';
import { sourceMemberKey } from './vacancyDeduplicator';

const ROW_PREFIX = 'cluster-';
/** Столько источников читается точечно: дольше — заведомо ложная склейка. */
const MAX_MEMBERS = 30;

/**
 * Цель отклика на вакансию, чьи название и место показывает карточка. Основатель склейки бывает
 * другой вакансией или уже снят: тогда её запись — участник с теми же названием и местом.
 */
export function resolveVacancyApplyTarget(
  engine: Pick<RouteDeps['multiSourceEngine'], 'getVacancy'>,
  cluster: VacancyCluster,
  redirected?: (url: string) => string | undefined,
): ApplyTarget | null {
  const read = (id: string): UnifiedVacancy | undefined => engine.getVacancy?.(id);
  const founderId = cluster.id.startsWith(ROW_PREFIX)
    ? cluster.id.slice(ROW_PREFIX.length)
    : cluster.id;
  const founder = read(founderId);
  const members = cluster.sources.slice(0, MAX_MEMBERS).flatMap((source) => {
    const id = sourceMemberKey(source);
    const member = id && id !== founderId ? read(id) : undefined;
    return member ? [member] : [];
  });
  const own = shownRecord(cluster, founder, members);
  // Записи нет: известен только адрес кластера, сверять двойников не с чем.
  if (!own) {
    const known = applyAddress(cluster.primaryUrl);
    return known && { ...known, origin: 'url' };
  }
  const others = members.filter((member) => member.id !== own.id);
  return resolveApplyTarget({ vacancy: own, members: others, redirected });
}

function shownRecord(
  cluster: VacancyCluster,
  founder: UnifiedVacancy | undefined,
  members: readonly UnifiedVacancy[],
): UnifiedVacancy | undefined {
  const shown = { title: cluster.canonicalTitle, location: cluster.canonicalLocation };
  if (founder && isShownPosting(shown, founder)) return founder;
  const same = members.filter(
    (member) => member.status === 'active' && isShownPosting(shown, member),
  );
  return same.find((member) => member.url === cluster.primaryUrl) ?? same[0];
}
