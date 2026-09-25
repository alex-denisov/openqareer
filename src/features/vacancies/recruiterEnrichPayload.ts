import type { MatchedVacancyItem } from '../coach/cabinetTypes';
import type { EnrichVacancyPayload } from './recruiterContactsApi';

/**
 * Both places that offer «Найти контакты» (the detail panel and the info
 * modal) hand the same cluster fields to `enrichRecruiterContacts`, so the
 * server can fall back to a title/company search when a source page never
 * listed a recruiter's name.
 */
export function recruiterEnrichPayload(
  cluster: MatchedVacancyItem['cluster'],
): EnrichVacancyPayload {
  return {
    id: cluster.id,
    title: cluster.canonicalTitle,
    company: cluster.canonicalCompany,
    url: cluster.primaryUrl,
    description: cluster.descriptionSummary,
  };
}
