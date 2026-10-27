import type { SqliteRecruiterContactsRepository } from '../data/sqliteRecruiterContactsRepository';
import type { SqliteLinkedinPoolRepository } from '../linkedinPool/sqliteLinkedinPoolRepository';
import type { FootprintRequestGate } from '../osint/adapters/requestScheduler';
import { createCompanySiteFinder, createOpenWebRecruiterFinder, resolveCompanyDomain } from './openWebRecruiterFinder';
import type { RecruiterContact } from '../../shared/recruiterContact';
import { withDossier } from './dossier/recruiterDossierService';
import { findHiringManager, hiringManagerContact } from './hiringManagerFinder';
import { defaultMxResolver, discoverRecruiterContacts } from './recruiterIntelligenceService';
import type { DiscoveryOptions, MxResolver, UnifiedVacancyInput } from './recruiterIntelligenceService';

export interface OpenWebDiscoveryOptions {
  readonly apiKey: string | undefined;
  readonly fetch?: typeof fetch;
  readonly requestGate?: FootprintRequestGate;
  readonly resolveMx?: MxResolver;
}

export interface RecruiterIntelligenceWorkerOptions {
  readonly repository: SqliteRecruiterContactsRepository;
  readonly resolveVacancy: (vacancyId: string) => UnifiedVacancyInput;
  readonly maxJobs?: number;
  readonly linkedinPool?: SqliteLinkedinPoolRepository;
  /** Путь без LinkedIn: открытые профили и домен почты по MX. */
  readonly openWeb?: OpenWebDiscoveryOptions;
}

function openWebDiscovery(options: RecruiterIntelligenceWorkerOptions): DiscoveryOptions {
  const { openWeb, linkedinPool } = options;
  if (!openWeb) return {};
  const resolveMx = openWeb.resolveMx ?? defaultMxResolver;
  const findSite = linkedinPool
    ? createCompanySiteFinder({
        repository: linkedinPool,
        apiKey: openWeb.apiKey,
        resolveMx,
        ...(openWeb.fetch ? { fetch: openWeb.fetch } : {}),
        ...(openWeb.requestGate ? { requestGate: openWeb.requestGate } : {}),
      })
    : undefined;
  return {
    mxResolver: resolveMx,
    resolveDomain: (vacancy: UnifiedVacancyInput) => resolveCompanyDomain(vacancy, resolveMx, findSite),
    ...(linkedinPool
      ? {
          openWebRecruiterFinder: createOpenWebRecruiterFinder({
            repository: linkedinPool,
            apiKey: openWeb.apiKey,
            ...(openWeb.fetch ? { fetch: openWeb.fetch } : {}),
            ...(openWeb.requestGate ? { requestGate: openWeb.requestGate } : {}),
          }),
        }
      : {}),
  };
}

/** Каналы B258 к каждому найденному человеку; без пути открытого веба — только известные каналы. */
async function withDossiers(
  contacts: readonly RecruiterContact[],
  vacancy: UnifiedVacancyInput,
  discovery: DiscoveryOptions,
  options: RecruiterIntelligenceWorkerOptions,
): Promise<RecruiterContact[]> {
  const { openWeb, linkedinPool } = options;
  if (!openWeb || !linkedinPool || contacts.length === 0) return [...contacts];
  const companyDomain =
    contacts.find((contact) => contact.email)?.email?.split('@')[1] ?? (await discovery.resolveDomain?.(vacancy));
  const result: RecruiterContact[] = [];
  for (const contact of contacts) {
    result.push(
      await withDossier(contact, companyDomain, {
        database: linkedinPool.getDatabase(),
        exaApiKey: openWeb.apiKey,
        ...(openWeb.fetch ? { fetch: openWeb.fetch } : {}),
        ...(openWeb.requestGate ? { requestGate: openWeb.requestGate } : {}),
      }),
    );
  }
  return result;
}

/** Нанимающий менеджер вакансии рядом с рекрутёром; тот же человек дважды не добавляется. */
async function hiringManager(
  vacancy: UnifiedVacancyInput,
  found: readonly RecruiterContact[],
  discovery: DiscoveryOptions,
  options: RecruiterIntelligenceWorkerOptions,
): Promise<RecruiterContact[]> {
  const { openWeb, linkedinPool } = options;
  if (!openWeb || !linkedinPool) return [];
  const manager = await findHiringManager(vacancy, {
    database: linkedinPool.getDatabase(),
    apiKey: openWeb.apiKey,
    ...(openWeb.fetch ? { fetch: openWeb.fetch } : {}),
    ...(openWeb.requestGate ? { requestGate: openWeb.requestGate } : {}),
  });
  if (!manager || found.some((contact) => contact.fullName.toLowerCase() === manager.fullName.toLowerCase())) return [];
  return [hiringManagerContact(vacancy, manager, await discovery.resolveDomain?.(vacancy), new Date())];
}

/** Processes a bounded durable batch outside the request handler. */
export async function runRecruiterIntelligenceJobs(
  options: RecruiterIntelligenceWorkerOptions,
): Promise<{ claimed: number; completed: number; failed: number }> {
  const jobs = options.repository.claimJobs(options.maxJobs ?? 1);
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      const vacancy = options.resolveVacancy(job.vacancyId);
      if (!vacancy.title) throw new Error('vacancy_not_found');
      const discovery = openWebDiscovery(options);
      const found = await discoverRecruiterContacts(vacancy, {
        linkedinPool: options.linkedinPool,
        ...discovery,
      });
      const people = [...found, ...(await hiringManager(vacancy, found, discovery, options))];
      const contacts = await withDossiers(people, vacancy, discovery, options);
      options.repository.saveContacts(job.candidateId, job.vacancyId, contacts);
      options.repository.finishJob(job.id, 'ready');
      completed += 1;
    } catch (error) {
      // Занятая база — не ошибка поиска: задание вернётся в очередь и пройдёт на следующем тике.
      if (error instanceof Error && /database is (locked|busy)/iu.test(error.message)) {
        options.repository.requeueJob(job.id);
        continue;
      }
      options.repository.finishJob(
        job.id,
        'failed',
        error instanceof Error ? error.message.slice(0, 160) : 'recruiter_enrichment_failed',
      );
      failed += 1;
    }
  }

  return { claimed: jobs.length, completed, failed };
}
