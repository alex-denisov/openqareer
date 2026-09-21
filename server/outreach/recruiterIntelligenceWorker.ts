import type { SqliteRecruiterContactsRepository } from '../data/sqliteRecruiterContactsRepository';
import { discoverRecruiterContacts } from './recruiterIntelligenceService';
import type { UnifiedVacancyInput } from './recruiterIntelligenceService';

export interface RecruiterIntelligenceWorkerOptions {
  readonly repository: SqliteRecruiterContactsRepository;
  readonly resolveVacancy: (vacancyId: string) => UnifiedVacancyInput;
  readonly maxJobs?: number;
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
      const contacts = await discoverRecruiterContacts(vacancy);
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
