import { createHash } from 'node:crypto';
import { normalizeCompanyName } from './company';
import type {
  CandidateCompanyOpportunity,
  CandidateCompanyRecruiter,
} from '../../shared/candidateCompany';
import type { CandidateCompanyWant } from '../data/sqliteCandidateCompanyWantsRepository';

type CandidateCompanyWantSummary = Pick<
  CandidateCompanyWant,
  'companyKey' | 'companyName' | 'nextStep' | 'nextStepDueAt'
>;

export interface CandidateCompanyVacancyInput {
  readonly id: string;
  readonly companyName: string;
  readonly location: string | null;
  readonly industry: string | null;
  readonly sourceName: string;
  readonly sourceDate: string;
  readonly href: string;
  readonly title: string;
}

export interface CandidateCompanyJobInput {
  readonly vacancyId: string;
  readonly status: 'queued' | 'running' | 'ready' | 'failed';
}

export interface CandidateNetworkContactCount {
  readonly count: number;
  readonly importedAt: string;
}

export function candidateCompanyKey(name: string): string {
  const normalized = normalizeCompanyName(name);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24);
}

export function buildCandidateCompanyRows(input: {
  readonly vacancies: readonly CandidateCompanyVacancyInput[];
  readonly wants: readonly CandidateCompanyWantSummary[];
  readonly recruiters: readonly CandidateCompanyRecruiter[];
  readonly jobs: readonly CandidateCompanyJobInput[];
  readonly networkContactCounts?: ReadonlyMap<string, CandidateNetworkContactCount>;
}): CandidateCompanyOpportunity[] {
  const companies = new Map<string, CompanyAccumulator>();
  for (const vacancy of input.vacancies) addVacancy(companies, vacancy);
  for (const want of input.wants) addWant(companies, want);
  for (const recruiter of input.recruiters) addRecruiter(companies, recruiter);
  for (const job of input.jobs) addRecruiterJob(companies, input.vacancies, job);

  return Array.from(companies.values(), (company) =>
    finishCompany(company, input.networkContactCounts?.get(company.key)),
  );
}

export function sortCandidateCompanyRows(
  rows: readonly CandidateCompanyOpportunity[],
  sort: 'default' | 'contacts' | 'alphabetical',
): CandidateCompanyOpportunity[] {
  const byName = (a: CandidateCompanyOpportunity, b: CandidateCompanyOpportunity) =>
    a.name.localeCompare(b.name, 'ru') || a.key.localeCompare(b.key);
  if (sort === 'alphabetical') return [...rows].sort(byName);
  if (sort === 'contacts') {
    return [...rows].sort(
      (a, b) => knownCount(b.contactsCount) - knownCount(a.contactsCount) || byName(a, b),
    );
  }
  return [...rows].sort(
    (a, b) =>
      Number(b.want) - Number(a.want) ||
      b.vacancyCount - a.vacancyCount ||
      knownCount(b.contactsCount) - knownCount(a.contactsCount) ||
      byName(a, b),
  );
}

export function filterCandidateCompanyRows(
  rows: readonly CandidateCompanyOpportunity[],
  filter: 'all' | 'want' | 'contacts' | 'recruiter',
  search = '',
): CandidateCompanyOpportunity[] {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  return rows.filter((company) => {
    if (filter === 'want' && !company.want) return false;
    if (filter === 'contacts' && !(company.contactsCount && company.contactsCount > 0))
      return false;
    if (filter === 'recruiter' && !company.hasRecruiter) return false;
    if (!query) return true;
    return [
      company.name,
      company.location ?? '',
      ...company.recruiters.map((recruiter) => recruiter.fullName),
    ].some((value) => value.toLocaleLowerCase('ru-RU').includes(query));
  });
}

function knownCount(value: number | null): number {
  return value ?? -1;
}

interface CompanyAccumulator {
  key: string;
  name: string;
  location: string | null;
  industry: string | null;
  want: boolean;
  nextStep: CandidateCompanyOpportunity['nextStep'];
  vacancies: Map<string, CandidateCompanyOpportunity['vacancies'][number]>;
  sources: Map<string, CandidateCompanyOpportunity['sources'][number]>;
  recruiters: Map<string, CandidateCompanyRecruiter>;
  jobStatuses: Set<CandidateCompanyJobInput['status']>;
}

function companyFor(companies: Map<string, CompanyAccumulator>, name: string): CompanyAccumulator {
  const key = candidateCompanyKey(name);
  const current = companies.get(key);
  if (current) return current;
  const created: CompanyAccumulator = {
    key,
    name: name.trim(),
    location: null,
    industry: null,
    want: false,
    nextStep: null,
    vacancies: new Map(),
    sources: new Map(),
    recruiters: new Map(),
    jobStatuses: new Set(),
  };
  companies.set(key, created);
  return created;
}

function addVacancy(
  companies: Map<string, CompanyAccumulator>,
  vacancy: CandidateCompanyVacancyInput,
): void {
  const name = vacancy.companyName.trim();
  if (!name) return;
  const company = companyFor(companies, name);
  if (!company.location && vacancy.location) company.location = vacancy.location;
  if (!company.industry && vacancy.industry) company.industry = vacancy.industry;
  company.vacancies.set(vacancy.id, {
    id: vacancy.id,
    title: vacancy.title,
    location: vacancy.location,
    sourceName: vacancy.sourceName,
    sourceDate: vacancy.sourceDate,
    href: vacancy.href,
  });
  if (vacancy.sourceName && vacancy.sourceDate) {
    company.sources.set(`${vacancy.sourceName}\u0000${vacancy.sourceDate}`, {
      name: vacancy.sourceName,
      observedAt: vacancy.sourceDate,
    });
  }
}

function addWant(
  companies: Map<string, CompanyAccumulator>,
  want: CandidateCompanyWantSummary,
): void {
  const company = companyFor(companies, want.companyName);
  company.want = true;
  company.nextStep = want.nextStep ? { text: want.nextStep, dueAt: want.nextStepDueAt } : null;
}

function addRecruiter(
  companies: Map<string, CompanyAccumulator>,
  recruiter: CandidateCompanyRecruiter,
): void {
  const company = companies.get(recruiter.companyKey);
  if (!company) return;
  const identity =
    recruiter.linkedinUrl?.toLocaleLowerCase() ||
    `${recruiter.fullName.toLocaleLowerCase('ru-RU')}\u0000${recruiter.roleTitle.toLocaleLowerCase('ru-RU')}`;
  if (!company.recruiters.has(identity)) company.recruiters.set(identity, recruiter);
}

function addRecruiterJob(
  companies: Map<string, CompanyAccumulator>,
  vacancies: readonly CandidateCompanyVacancyInput[],
  job: CandidateCompanyJobInput,
): void {
  const vacancy = vacancies.find((item) => item.id === job.vacancyId);
  if (vacancy) companyFor(companies, vacancy.companyName).jobStatuses.add(job.status);
}

function finishCompany(
  company: CompanyAccumulator,
  contactCount: CandidateNetworkContactCount | undefined,
): CandidateCompanyOpportunity {
  const recruiters = Array.from(company.recruiters.values());
  const statuses = company.jobStatuses;
  const recruiterSearchStatus =
    recruiters.length > 0
      ? 'ready'
      : statuses.has('running')
        ? 'running'
        : statuses.has('queued')
          ? 'queued'
          : statuses.has('failed')
            ? 'failed'
            : 'idle';
  const vacancies = Array.from(company.vacancies.values());
  return {
    key: company.key,
    name: company.name,
    location: company.location,
    industry: company.industry,
    vacancyCount: company.vacancies.size,
    contactsCount: contactCount?.count ?? null,
    contactsImportedAt: contactCount?.importedAt ?? null,
    want: company.want,
    nextStep: company.nextStep,
    hasRecruiter: recruiters.length > 0,
    recruiterSearchStatus,
    sources: Array.from(company.sources.values()).sort((a, b) =>
      b.observedAt.localeCompare(a.observedAt),
    ),
    vacancies: vacancies.slice(0, 3),
    recruiters,
  };
}
