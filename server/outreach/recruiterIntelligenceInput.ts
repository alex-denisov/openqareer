import type { RouteDeps } from '../routes/deps';
import type { UnifiedVacancyInput } from './recruiterIntelligenceService';

/** Resolve only the canonical server-owned vacancy; client payload is ignored. */
export function buildRecruiterVacancyInput(
  vacancyId: string,
  deps: Pick<RouteDeps, 'multiSourceEngine'>,
): UnifiedVacancyInput {
  const cluster = deps.multiSourceEngine?.getActiveCluster?.(vacancyId);
  const poolVacancy = !cluster
    ? deps.multiSourceEngine?.getVacancy?.(vacancyId)
    : undefined;

  return {
    id: vacancyId,
    title: cluster?.canonicalTitle ?? poolVacancy?.title,
    company: cluster?.canonicalCompany ?? poolVacancy?.company,
    url: cluster?.primaryUrl ?? poolVacancy?.url,
    description: cluster?.descriptionSummary ?? poolVacancy?.description,
    fullDescription: poolVacancy?.fullDescription,
    contactInfo: poolVacancy?.contactInfo,
  };
}
