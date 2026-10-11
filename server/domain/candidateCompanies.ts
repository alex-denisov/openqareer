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

export type ConnectionCircleStrength = 'direct' | 'strong' | 'weak' | 'unknown';
export type ConnectionCircleNumber = 1 | 2 | 3;
export type ConnectionCircleState = 'available' | 'none' | 'unknown';

export interface ConnectionCircleWorkplace {
  readonly companyName: string;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
}

export interface ConnectionCirclePerson {
  readonly id: string;
  readonly fullName: string;
  readonly roleTitle: string | null;
  readonly companyName: string | null;
  readonly linkedinUrl?: string | null;
  readonly workplaces?: readonly ConnectionCircleWorkplace[];
}

export interface CandidateConnectionContact extends ConnectionCirclePerson {
  readonly source: 'manual' | 'linkedin_import';
  readonly relationship: string;
  readonly strength: Exclude<ConnectionCircleStrength, 'direct'>;
  readonly knowsRecruiterIds: readonly string[];
}

export interface ConnectionCirclePath {
  readonly id: string;
  readonly circle: ConnectionCircleNumber;
  readonly path: readonly ConnectionCirclePerson[];
  readonly recipient: ConnectionCirclePerson;
  readonly evidence: readonly string[];
  readonly strength: ConnectionCircleStrength;
  readonly source: 'manual' | 'linkedin_import' | 'work_history' | 'cold';
  readonly nextStep: 'write_known_contact' | 'ask_for_introduction' | 'cold_application';
}

export interface ConnectionCircleResult {
  readonly circle: ConnectionCircleNumber;
  readonly state: ConnectionCircleState;
  readonly message: string;
  readonly paths: readonly ConnectionCirclePath[];
}

export interface BuildConnectionCirclesInput {
  readonly candidate: { readonly id: string; readonly fullName: string };
  readonly vacancy: { readonly id: string; readonly companyName: string; readonly title: string };
  readonly candidateWorkplaces: readonly ConnectionCircleWorkplace[];
  readonly recruiters: readonly ConnectionCirclePerson[];
  readonly contacts: readonly CandidateConnectionContact[];
  /** False means the candidate has not imported an exhaustive LinkedIn contact list. */
  readonly linkedinContactsImported: boolean;
}

const CONNECTION_PATH_LIMIT = 100;

export function buildConnectionCircles(input: BuildConnectionCirclesInput): {
  readonly circles: readonly ConnectionCircleResult[];
} {
  const direct = directConnectionPaths(input);
  const introductions = introductionPaths(input);
  const cold = coldOutreachPaths(input);
  return {
    circles: [
      resultForCircle(1, direct, input.linkedinContactsImported),
      resultForCircle(2, introductions, input.linkedinContactsImported),
      { circle: 3, state: 'available', message: '', paths: cold.slice(0, CONNECTION_PATH_LIMIT) },
    ],
  };
}

function directConnectionPaths(input: BuildConnectionCirclesInput): ConnectionCirclePath[] {
  return input.recruiters
    .flatMap((recruiter) => {
      const directContact = input.contacts.find((contact) =>
        sameConnectionPerson(contact, recruiter),
      );
      if (directContact) return [directContactPath(input.candidate, directContact, recruiter)];
      const evidence = sharedWorkplaceEvidence(
        input.candidateWorkplaces,
        recruiter.workplaces ?? [],
      );
      return evidence ? [workplacePath(input.candidate, recruiter, evidence)] : [];
    })
    .sort(compareConnectionPaths);
}

function introductionPaths(input: BuildConnectionCirclesInput): ConnectionCirclePath[] {
  const paths = input.contacts.flatMap((contact) =>
    input.recruiters
      .filter((recruiter) => contact.knowsRecruiterIds.includes(recruiter.id))
      .map((recruiter) => introductionPath(input.candidate, contact, recruiter)),
  );
  return paths.sort(compareConnectionPaths).slice(0, CONNECTION_PATH_LIMIT);
}

function coldOutreachPaths(input: BuildConnectionCirclesInput): ConnectionCirclePath[] {
  const recipients =
    input.recruiters.length > 0
      ? input.recruiters
      : [
          {
            id: 'vacancy:' + input.vacancy.id,
            fullName: input.vacancy.companyName,
            roleTitle: input.vacancy.title,
            companyName: input.vacancy.companyName,
          },
        ];
  return recipients.map((recipient) => ({
    id: 'circle-3:' + recipient.id,
    circle: 3,
    path: [candidateNode(input.candidate), recipient],
    recipient,
    evidence: ['Холодный отклик по вакансии; ничего не отправлено.'],
    strength: 'unknown',
    source: 'cold',
    nextStep: 'cold_application',
  }));
}

function directContactPath(
  candidate: BuildConnectionCirclesInput['candidate'],
  contact: CandidateConnectionContact,
  recruiter: ConnectionCirclePerson,
): ConnectionCirclePath {
  return {
    id: 'circle-1:' + recruiter.id + ':' + contact.id,
    circle: 1,
    path: [candidateNode(candidate), recruiter],
    recipient: recruiter,
    evidence: [contact.relationship || 'Прямой контакт подтверждён кандидатом.'],
    strength: 'direct',
    source: contact.source,
    nextStep: 'write_known_contact',
  };
}

function workplacePath(
  candidate: BuildConnectionCirclesInput['candidate'],
  recruiter: ConnectionCirclePerson,
  match: { companyName: string; evidence: string; strength: 'strong' | 'weak' },
): ConnectionCirclePath {
  return {
    id: 'circle-1:work:' + recruiter.id + ':' + candidateCompanyKey(match.companyName),
    circle: 1,
    path: [candidateNode(candidate), recruiter],
    recipient: recruiter,
    evidence: [match.evidence],
    strength: match.strength,
    source: 'work_history',
    nextStep: 'write_known_contact',
  };
}

function introductionPath(
  candidate: BuildConnectionCirclesInput['candidate'],
  contact: CandidateConnectionContact,
  recruiter: ConnectionCirclePerson,
): ConnectionCirclePath {
  return {
    id: 'circle-2:' + contact.id + ':' + recruiter.id,
    circle: 2,
    path: [candidateNode(candidate), contactNode(contact), recruiter],
    recipient: recruiter,
    evidence: [contact.relationship, 'Связь с адресатом указана в источнике контакта.'],
    strength: contact.strength,
    source: contact.source,
    nextStep: 'ask_for_introduction',
  };
}

function resultForCircle(
  circle: 1 | 2,
  paths: readonly ConnectionCirclePath[],
  linkedinContactsImported: boolean,
): ConnectionCircleResult {
  const state = paths.length > 0 ? 'available' : linkedinContactsImported ? 'none' : 'unknown';
  const message =
    state === 'none'
      ? 'Знакомых не найдено в импортированном списке.'
      : state === 'unknown'
        ? 'Связи неизвестны: список LinkedIn не импортирован.'
        : '';
  return { circle, state, message, paths: paths.slice(0, CONNECTION_PATH_LIMIT) };
}

function sharedWorkplaceEvidence(
  candidateWorkplaces: readonly ConnectionCircleWorkplace[],
  recruiterWorkplaces: readonly ConnectionCircleWorkplace[],
): { companyName: string; evidence: string; strength: 'strong' | 'weak' } | null {
  for (const candidate of candidateWorkplaces) {
    const recruiter = recruiterWorkplaces.find(
      (item) =>
        candidateCompanyKey(item.companyName) === candidateCompanyKey(candidate.companyName),
    );
    if (!recruiter) continue;
    const overlaps = workplacePeriodsOverlap(candidate, recruiter);
    const phrase = overlaps
      ? 'Периоды работы пересекались'
      : 'Общий работодатель, периоды не подтверждены';
    return {
      companyName: candidate.companyName,
      evidence: phrase + ': ' + candidate.companyName + '.',
      strength: overlaps ? 'strong' : 'weak',
    };
  }
  return null;
}

function workplacePeriodsOverlap(
  left: ConnectionCircleWorkplace,
  right: ConnectionCircleWorkplace,
): boolean {
  const leftStart = yearOf(left.startDate);
  const rightStart = yearOf(right.startDate);
  if (leftStart === null || rightStart === null) return false;
  const leftEnd = yearOf(left.endDate) ?? Number.POSITIVE_INFINITY;
  const rightEnd = yearOf(right.endDate) ?? Number.POSITIVE_INFINITY;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function yearOf(date: string | null | undefined): number | null {
  const year = date?.match(/(?:19|20)\d{2}/u)?.[0];
  return year ? Number(year) : null;
}

function sameConnectionPerson(
  contact: CandidateConnectionContact,
  recruiter: ConnectionCirclePerson,
): boolean {
  const contactUrl = normalizeLinkedInUrl(contact.linkedinUrl);
  const recruiterUrl = normalizeLinkedInUrl(recruiter.linkedinUrl);
  if (contactUrl && recruiterUrl) return contactUrl === recruiterUrl;
  return (
    normalizePersonName(contact.fullName) === normalizePersonName(recruiter.fullName) &&
    candidateCompanyKey(contact.companyName ?? '') ===
      candidateCompanyKey(recruiter.companyName ?? '')
  );
}

function normalizeLinkedInUrl(value: string | null | undefined): string {
  return value ? value.trim().replace(/\/$/u, '').toLocaleLowerCase('und') : '';
}

function normalizePersonName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
}

function candidateNode(
  candidate: BuildConnectionCirclesInput['candidate'],
): ConnectionCirclePerson {
  return { id: candidate.id, fullName: candidate.fullName, roleTitle: null, companyName: null };
}

function contactNode(contact: CandidateConnectionContact): ConnectionCirclePerson {
  return {
    id: contact.id,
    fullName: contact.fullName,
    roleTitle: contact.roleTitle,
    companyName: contact.companyName,
    linkedinUrl: contact.linkedinUrl,
  };
}

function compareConnectionPaths(left: ConnectionCirclePath, right: ConnectionCirclePath): number {
  const strengthRank: Record<ConnectionCircleStrength, number> = {
    direct: 4,
    strong: 3,
    weak: 2,
    unknown: 1,
  };
  return (
    strengthRank[right.strength] - strengthRank[left.strength] ||
    left.recipient.fullName.localeCompare(right.recipient.fullName, 'ru') ||
    left.id.localeCompare(right.id)
  );
}
