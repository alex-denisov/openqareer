import type {
  CandidateCompanyDetails,
  CandidateCompanyFilter,
  CandidateCompanyPage,
  CandidateCompanySort,
} from '../../../shared/candidateCompany';
import { apiFetch, readData } from '../coach/apiClient';

export interface CandidateCompanyQuery {
  readonly offset?: number;
  readonly sort?: CandidateCompanySort;
  readonly filter?: CandidateCompanyFilter;
  readonly search?: string;
}

export async function getCandidateCompanyPage(
  query: CandidateCompanyQuery = {},
): Promise<CandidateCompanyPage> {
  const params = new URLSearchParams({
    offset: String(query.offset ?? 0),
    limit: '20',
    sort: query.sort ?? 'default',
    filter: query.filter ?? 'all',
  });
  if (query.search?.trim()) params.set('search', query.search.trim());
  const response = await apiFetch(`/api/v1/candidate/companies?${params.toString()}`);
  return readData<CandidateCompanyPage>(response);
}

export async function getCandidateCompanyDetails(
  companyKey: string,
  vacancyOffset = 0,
): Promise<CandidateCompanyDetails> {
  const params = new URLSearchParams({ vacancyOffset: String(vacancyOffset), vacancyLimit: '20' });
  const response = await apiFetch(
    `/api/v1/candidate/companies/${encodeURIComponent(companyKey)}?${params.toString()}`,
  );
  return readData<CandidateCompanyDetails>(response);
}

export async function setCandidateCompanyWant(companyKey: string): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/companies/${encodeURIComponent(companyKey)}/want`,
    { method: 'PUT' },
  );
  await readData(response);
}

export async function removeCandidateCompanyWant(companyKey: string): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/companies/${encodeURIComponent(companyKey)}/want`,
    { method: 'DELETE' },
  );
  await readData(response);
}

export async function saveCandidateCompanyNextStep(
  companyKey: string,
  text: string,
  dueAt: string | null,
): Promise<void> {
  const response = await apiFetch(
    `/api/v1/candidate/companies/${encodeURIComponent(companyKey)}/next-step`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dueAt }),
    },
  );
  await readData(response);
}

export async function searchCandidateCompanyRecruiter(companyKey: string): Promise<{
  readonly searchStatus: 'queued' | 'running' | 'ready' | 'failed';
}> {
  const response = await apiFetch(
    `/api/v1/candidate/companies/${encodeURIComponent(companyKey)}/recruiter-search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  return readData(response);
}
