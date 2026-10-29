import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RecruiterContact, RecruiterSourceReceipt } from '../../shared/recruiterContact';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import type { RouteDeps } from './deps';
import { withDeps } from './helpers';
import {
  MAX_CONNECTION_CONTACTS,
  connectionCandidate,
  connectionRecords,
  connectionRepository,
  importedContactId,
  linkedinUrlSchema,
  readCandidateMatchedVacancies,
  readConnectionMetadata,
  saveConnectionRecords,
  toStoredConnectionContact,
  type ConnectionRepository,
  type ImportedContactInput,
} from './candidateConnectionRoutes';
import { profileKey } from './connectionImportMerge';
import { recordSearchedNetwork } from './networkIndexFeed';

/**
 * B561: the desktop searches the candidate's 1st circle by company name and
 * reports the people whose current place it read. The server plans which
 * companies to search (wanted first, then vacancy companies, each at most
 * once per 14 days) and gives the found people their company.
 */
// v2: the first desktop run (29.10) re-read one company's page for seven
// others and logged them as searched; a fresh log plans them again.
const SEARCH_LOG_SCOPE_ID = '__b561_linkedin_company_search_log_v2__';
const SEARCH_LOG_RECORD_ID = 'b561-linkedin-company-search-log';
const SEARCH_REPEAT_MS = 14 * 24 * 60 * 60 * 1_000;
const MAX_PLANNED_COMPANIES = 10;
const MAX_LOGGED_COMPANIES = 1_000;
const MAX_PEOPLE_PER_REPORT = 50;

const searchedPersonSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    linkedinUrl: linkedinUrlSchema.transform(plainProfileUrl),
    roleTitle: z.string().trim().max(160).default(''),
    companyName: z.string().trim().min(1).max(180),
  })
  .strict();
const searchReportSchema = z
  .object({
    companyName: z.string().trim().min(1).max(180),
    people: z.array(searchedPersonSchema).max(MAX_PEOPLE_PER_REPORT),
  })
  .strict();
const searchLogSchema = z.record(z.string().max(200), z.string().datetime({ offset: true }));

type SearchedPerson = z.infer<typeof searchedPersonSchema>;

/** `https://www.linkedin.com/in/<slug>/`, without query, fragment or host variants. */
function plainProfileUrl(url: string): string {
  const slug = new URL(url).pathname.split('/').filter(Boolean)[1] ?? '';
  return `https://www.linkedin.com/in/${slug}/`;
}

/** Operator switch: the plan comes back empty, so no desktop searches (security review). */
function searchSwitchedOff(): boolean {
  return process.env.LINKEDIN_COMPANY_SEARCH_DISABLED === '1';
}

export function registerConnectionSearchRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/connection-contacts/linkedin-search-plan',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleSearchPlan),
  );
  app.post(
    '/api/v1/candidate/connection-contacts/linkedin-search',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleSearchReport),
  );
}

async function handleSearchPlan(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = connectionCandidate(deps, request, reply, false);
  if (!candidate) return undefined;
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return undefined;
  if (searchSwitchedOff()) return { data: { companies: [] }, meta: { requestId: request.id } };
  const wanted = (deps.candidateCompanyWantsRepo?.list(candidate.id) ?? []).map(
    (want) => want.companyName,
  );
  const vacancies = (await readCandidateMatchedVacancies(deps, candidate.id)).map(
    (item) => item.cluster.canonicalCompany,
  );
  const searched = readSearchLog(repository, candidate.id);
  const now = Date.now();
  const companies = plannedCompanies([...wanted, ...vacancies], (key) => {
    const at = searched[key];
    return at !== undefined && now - Date.parse(at) < SEARCH_REPEAT_MS;
  });
  return { data: { companies }, meta: { requestId: request.id } };
}

function plannedCompanies(
  names: readonly string[],
  recentlySearched: (key: string) => boolean,
): Array<{ companyKey: string; companyName: string }> {
  const seen = new Set<string>();
  const planned: Array<{ companyKey: string; companyName: string }> = [];
  for (const raw of names) {
    const companyName = raw.trim();
    const companyKey = companyName ? candidateCompanyKey(companyName) : '';
    if (!companyKey || seen.has(companyKey)) continue;
    seen.add(companyKey);
    if (!recentlySearched(companyKey)) planned.push({ companyKey, companyName });
    if (planned.length >= MAX_PLANNED_COMPANIES) break;
  }
  return planned;
}

async function handleSearchReport(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = connectionCandidate(deps, request, reply, true);
  if (!candidate) return undefined;
  const repository = connectionRepository(deps, request, reply);
  if (!repository) return undefined;
  const report = searchReportSchema.parse(request.body);
  const now = new Date().toISOString();
  const merged = mergeSearchedPeople(
    candidate.id,
    connectionRecords(repository, candidate.id),
    report.people,
    now,
  );
  if (merged.updated + merged.added > 0) {
    saveConnectionRecords(repository, candidate.id, merged.records);
  }
  writeSearchLog(repository, candidate.id, candidateCompanyKey(report.companyName), now);
  recordSearchedNetwork(deps, candidate.id, report.people, now);
  return {
    data: { updated: merged.updated, added: merged.added },
    meta: { requestId: request.id },
  };
}

/**
 * Found people take the searched current company. A person already imported
 * from the connections list is matched by profile; one not reached yet is
 * added, since the search is limited to the 1st circle. Manual contacts and
 * the import receipt are left as they are.
 */
function mergeSearchedPeople(
  candidateId: string,
  records: readonly RecruiterContact[],
  people: readonly SearchedPerson[],
  now: string,
): { records: RecruiterContact[]; updated: number; added: number } {
  const byProfile = new Map(
    records.flatMap((record, index) => {
      const key = profileKey(record.linkedinUrl);
      return key && readConnectionMetadata(record) ? [[key, index] as const] : [];
    }),
  );
  const usedIds = new Set(
    records.flatMap((record) => readConnectionMetadata(record)?.contactId ?? []),
  );
  const next = [...records];
  const added: RecruiterContact[] = [];
  let updated = 0;
  let room = MAX_CONNECTION_CONTACTS - usedIds.size;
  for (const person of people) {
    const key = profileKey(person.linkedinUrl)!;
    const index = byProfile.get(key);
    if (index !== undefined) {
      const record = next[index]!;
      if (record.sourceType !== 'candidate_linkedin_connection') continue;
      next[index] = withSearchedPlace(record, person, now);
      updated += 1;
      continue;
    }
    if (room <= 0) continue;
    added.push(newSearchedContact(candidateId, uniqueContactId(person, usedIds), person, now));
    byProfile.set(key, -1);
    room -= 1;
  }
  return { records: [...next, ...added], updated, added: added.length };
}

function newSearchedContact(
  candidateId: string,
  contactId: string,
  person: SearchedPerson,
  now: string,
): RecruiterContact {
  return toStoredConnectionContact(
    candidateId,
    contactId,
    {
      fullName: person.fullName,
      companyName: person.companyName,
      roleTitle: person.roleTitle,
      linkedinUrl: person.linkedinUrl,
      relationship: 'Контакт из импортированного списка LinkedIn',
      strength: 'unknown',
      workplaces: [],
      knowsRecruiterIds: [],
    },
    'linkedin_import',
    now,
    now,
    { companySource: 'search', companyObservedAt: now },
  );
}

function withSearchedPlace(
  record: RecruiterContact,
  person: SearchedPerson,
  now: string,
): RecruiterContact {
  const metadata = readConnectionMetadata(record)!;
  const receipt = record.sourceReceipt as RecruiterSourceReceipt & Record<string, unknown>;
  return {
    ...record,
    companyName: person.companyName,
    roleTitle: person.roleTitle,
    sourceReceipt: {
      ...receipt,
      connection: { ...metadata, companySource: 'search', companyObservedAt: now },
    } as RecruiterSourceReceipt,
    updatedAt: now,
  };
}

function uniqueContactId(person: SearchedPerson, usedIds: Set<string>): string {
  const base = importedContactId({ linkedinUrl: person.linkedinUrl } as ImportedContactInput);
  let id = base;
  for (let suffix = 1; usedIds.has(id); suffix += 1) id = base + '-' + suffix;
  usedIds.add(id);
  return id;
}

function readSearchLog(
  repository: ConnectionRepository,
  candidateId: string,
): Readonly<Record<string, string>> {
  const record = repository.getContactsByVacancyId(candidateId, SEARCH_LOG_SCOPE_ID)[0];
  const raw = (record?.sourceReceipt as { searchedCompanies?: unknown } | undefined)
    ?.searchedCompanies;
  return searchLogSchema.safeParse(raw).data ?? {};
}

function writeSearchLog(
  repository: ConnectionRepository,
  candidateId: string,
  companyKey: string,
  now: string,
): void {
  const entries = Object.entries({ ...readSearchLog(repository, candidateId), [companyKey]: now })
    .sort(([, left], [, right]) => right.localeCompare(left))
    .slice(0, MAX_LOGGED_COMPANIES);
  const sourceReceipt = {
    receiptId: SEARCH_LOG_RECORD_ID,
    source: 'candidate-desktop-search',
    method: 'linkedin-people-search',
    observedAt: now,
    confidence: 1,
    searchedCompanies: Object.fromEntries(entries),
  } as RecruiterSourceReceipt & { searchedCompanies: Record<string, string> };
  repository.saveContacts(candidateId, SEARCH_LOG_SCOPE_ID, [
    {
      id: `${SEARCH_LOG_RECORD_ID}-${candidateId}`,
      vacancyId: SEARCH_LOG_SCOPE_ID,
      companyName: '',
      fullName: 'Company search log',
      roleTitle: '',
      email: null,
      emailStatus: 'unverified',
      phone: null,
      telegram: null,
      whatsapp: null,
      linkedinUrl: null,
      githubUrl: null,
      twitterUrl: null,
      sourceType: 'candidate_connection_search_log',
      confidence: 1,
      sourceReceipt,
      createdAt: now,
      updatedAt: now,
    },
  ]);
}
