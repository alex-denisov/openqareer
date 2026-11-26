import type { ResumeVersionSummary } from '../../../../server/domain/resumeVersions';
import { getCandidateCampaign } from '../../coach/matchedVacancyApi';
import { listCandidateConnectionContacts } from '../../outreach/connectionContactsApi';
import { getResumeVersions } from '../../resume/resumeVersionsApi';
import { loadConditions } from '../career/conditionsApi';
import { searchRole, termsRows, type TermsRow } from './profileAsideModel';

/** Сколько резюме под вакансии видно в профиле; остальные — в «Откликах». */
export const VERSIONS_SHOWN = 3;

export interface ProfileTerms {
  readonly rows: readonly TermsRow[];
  /** Первая роль поиска, по-русски, если её назвала платформа; `null` — роли не выбраны. */
  readonly role: string | null;
}

export async function loadTerms(signal: AbortSignal): Promise<ProfileTerms> {
  const [campaign, conditions] = await Promise.all([
    getCandidateCampaign(signal),
    loadConditions(signal),
  ]);
  const role = searchRole(campaign.roles, campaign.titlesRu);
  return { rows: termsRows(role ? [role] : [], conditions.conditions), role };
}

export async function loadLinksTotal(): Promise<number> {
  return (await listCandidateConnectionContacts(0)).total;
}

export interface ProfileVersions {
  readonly items: readonly ResumeVersionSummary[];
  readonly total: number;
}

export async function loadVersions(signal: AbortSignal): Promise<ProfileVersions> {
  const page = await getResumeVersions({ limit: VERSIONS_SHOWN, perVacancy: true, signal });
  return { items: page.items.slice(0, VERSIONS_SHOWN), total: page.totalCount };
}
