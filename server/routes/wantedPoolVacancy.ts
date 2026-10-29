import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { companyMatchName } from '../vacancies/vacancyDeduplicator';
import type { RouteDeps } from './deps';

/**
 * The company screen lists a wanted company's vacancies from the pool when none is in the
 * selection; their circles are read under the wanted name so people land on that company.
 */
export function wantedPoolVacancy(
  deps: RouteDeps,
  candidateId: string,
  vacancyId: string,
): MatchedVacancyItem | undefined {
  const engine = deps.multiSourceEngine as Partial<
    Pick<RouteDeps['multiSourceEngine'], 'getStoredCluster'>
  >;
  const cluster = engine.getStoredCluster?.(vacancyId);
  if (!cluster || cluster.status !== 'active') return undefined;
  const name = companyMatchName(cluster.canonicalCompany);
  const want = (deps.candidateCompanyWantsRepo?.list(candidateId) ?? []).find(
    (item) => companyMatchName(item.companyName) === name,
  );
  if (!name || !want) return undefined;
  return {
    cluster: { ...cluster, canonicalCompany: want.companyName },
  } as unknown as MatchedVacancyItem;
}
