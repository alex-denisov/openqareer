import { hhVacancyIdFromUrl } from '../../shared/hhCandidateSession';
import { isHhSource, preferredApplySource } from '../../shared/hhVacancySource';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import type { RouteDeps } from '../routes/deps';
import { applyRedirects } from './applyRedirect';
import { resolveVacancyApplyTarget } from './vacancyApplyTarget';

type Deps = Pick<RouteDeps, 'candidateStore' | 'multiSourceEngine'>;

/** Адрес, по которому уйдёт ещё не отправленный отклик: hh.ru среди источников, иначе конечная цель. */
function openRouteUrl(deps: Deps, cluster: VacancyCluster): string {
  const pool = preferredApplySource(cluster);
  if (pool.hh) return pool.url;
  const target = resolveVacancyApplyTarget(deps.multiSourceEngine, cluster, applyRedirects.peek);
  return target && !target.needsRedirect ? target.url : pool.url;
}

/**
 * Отклик уходит на hh.ru: там кандидата представляет его резюме hh.ru, своего резюме платформа
 * не готовит. Правило то же, что у экрана отклика (`applyRoute`): снимок отклика главнее подборки,
 * кроме неотправленного со снимком другой площадки.
 */
export function appliesOnHh(
  deps: Deps,
  candidateId: string,
  vacancyId: string,
  cluster: VacancyCluster,
): boolean {
  const application = deps.candidateStore
    .listApplications(candidateId)
    .find((item) => item.clusterId === vacancyId);
  const vacancy = application?.vacancy;
  const hhSnapshot =
    vacancy &&
    isHhSource({ sourceType: vacancy.source, sourceName: vacancy.source, sourceUrl: vacancy.url });
  const open = !application || (application.stage === 'saved' && !hhSnapshot);
  return hhVacancyIdFromUrl(open ? openRouteUrl(deps, cluster) : vacancy?.url) !== null;
}
