import type { SqliteRecruiterContactsRepository } from '../data/sqliteRecruiterContactsRepository';
import type { SqliteLinkedinPoolRepository } from '../linkedinPool/sqliteLinkedinPoolRepository';
import type { FootprintRequestGate } from '../osint/adapters/requestScheduler';
import { createOpenWebRecruiterFinder, resolveCompanyDomain } from './openWebRecruiterFinder';
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
  return {
    mxResolver: resolveMx,
    resolveDomain: (vacancy: UnifiedVacancyInput) => resolveCompanyDomain(vacancy, resolveMx),
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
      const contacts = await discoverRecruiterContacts(vacancy, {
        linkedinPool: options.linkedinPool,
        ...openWebDiscovery(options),
      });
      options.repository.saveContacts(job.candidateId, job.vacancyId, contacts);
      options.repository.finishJob(job.id, 'ready');
      completed += 1;
    } catch (error) {
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
