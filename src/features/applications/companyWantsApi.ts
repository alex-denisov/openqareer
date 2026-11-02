import type {
  CandidateCompanyContactsFilter,
  CandidateCompanyWantPage,
  CandidateCompanyWantSelectionItem,
  CandidateCompanyWantSort,
  CandidateCompanyWantStageFilter,
} from '../../../shared/candidateCompany';
import { apiFetch, readData } from '../coach/apiClient';

export const COMPANY_WANT_PAGE_SIZE = 20;
/** Mirrors the server bulk limit: «до 500 компаний за раз». */
export const COMPANY_WANT_BULK_LIMIT = 500;

export interface CompanyWantQuery {
  readonly stage: CandidateCompanyWantStageFilter;
  readonly search: string;
  readonly industry: string;
  readonly contacts: CandidateCompanyContactsFilter;
  readonly sort: CandidateCompanyWantSort;
}

export const DEFAULT_COMPANY_WANT_QUERY: CompanyWantQuery = {
  stage: 'all',
  search: '',
  industry: '',
  contacts: 'any',
  sort: 'vacancies',
};

function queryParams(query: CompanyWantQuery): URLSearchParams {
  const params = new URLSearchParams({
    stage: query.stage,
    contacts: query.contacts,
    sort: query.sort,
  });
  if (query.search.trim()) params.set('search', query.search.trim());
  if (query.industry) params.set('industry', query.industry);
  return params;
}

export async function getCompanyWantPage(
  query: CompanyWantQuery,
  offset: number,
): Promise<CandidateCompanyWantPage> {
  const params = queryParams(query);
  params.set('offset', String(offset));
  params.set('limit', String(COMPANY_WANT_PAGE_SIZE));
  const response = await apiFetch(`/api/v1/candidate/companies/wants?${params.toString()}`);
  return readData<CandidateCompanyWantPage>(response);
}

export async function getCompanyWantSelection(query: CompanyWantQuery): Promise<{
  readonly items: readonly CandidateCompanyWantSelectionItem[];
  readonly total: number;
}> {
  const response = await apiFetch(
    `/api/v1/candidate/companies/wants/selection?${queryParams(query).toString()}`,
  );
  return readData(response);
}

export async function searchCompanyWantPaths(
  companyKeys: readonly string[],
): Promise<{ readonly queuedCount: number; readonly skippedCount: number }> {
  const response = await apiFetch('/api/v1/candidate/companies/wants/recruiter-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyKeys }),
  });
  return readData(response);
}
