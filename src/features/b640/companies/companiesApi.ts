import type {
  B640CompanyCard,
  B640CompanyPage,
  B640CompanyPeoplePage,
} from '../../../../shared/b640Companies';
import type { CandidateCompanyFilter, CandidateCompanySort } from '../../../../shared/candidateCompany';
import type { MatchedVacancyItem } from '../../coach/cabinetTypes';
import { apiFetch, readData } from '../../coach/apiClient';

const BASE = '/api/v1/candidate/b640/companies';

export interface B640CompanyQuery {
  readonly offset?: number;
  readonly sort?: CandidateCompanySort;
  readonly filter?: CandidateCompanyFilter;
  readonly search?: string;
  readonly relocation?: boolean;
  readonly city?: string | null;
}

export type CompanyCard = B640CompanyCard<MatchedVacancyItem>;

/** B677: компании подборки порциями по 20, с релокацией и городами. */
export async function getB640CompanyPage(query: B640CompanyQuery = {}): Promise<B640CompanyPage> {
  const params = new URLSearchParams({
    offset: String(query.offset ?? 0),
    limit: '20',
    sort: query.sort ?? 'default',
    filter: query.filter ?? 'all',
  });
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.relocation) params.set('relocation', '1');
  if (query.city) params.set('city', query.city);
  return readData<B640CompanyPage>(await apiFetch(`${BASE}?${params.toString()}`));
}

/** Карточка компании по хеш-ключу списка или по названию из карточки вакансии. */
export async function getB640Company(companyId: string, offset = 0): Promise<CompanyCard> {
  const params = new URLSearchParams({ offset: String(offset), limit: '20' });
  return readData<CompanyCard>(await apiFetch(`${BASE}/${encodeURIComponent(companyId)}?${params.toString()}`));
}

export async function getB640CompanyPeople(companyId: string, offset = 0): Promise<B640CompanyPeoplePage> {
  const params = new URLSearchParams({ offset: String(offset), limit: '20' });
  return readData<B640CompanyPeoplePage>(
    await apiFetch(`${BASE}/${encodeURIComponent(companyId)}/people?${params.toString()}`),
  );
}
