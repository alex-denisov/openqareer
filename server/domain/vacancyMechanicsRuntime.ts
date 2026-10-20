import { minimizeModelText } from '../providers/modelInputPrivacy';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from '../data/sqliteBusyTimeout';
import { DatabaseSync } from 'node:sqlite';
import type { VacancyFitView } from '../../shared/vacancyFit';
import { SqliteVacancyRequirementsStore } from '../data/sqliteVacancyRequirementsStore';
import { SqliteVacancyFitStore } from '../data/sqliteVacancyFitStore';
import { SealedText } from '../data/sealedText';
import { extractVacancyRequirementsWithFallback, vacancyDescriptionHash } from './vacancyRequirements';
import { assessVacancyFit, type VacancyFitInput } from './vacancyFit';
import { createVacancyFitAssessor } from './vacancyFitAssessor';
import type { BulkLlmClient } from '../providers/bulkLlmClient';

/** The HTTP process enqueues/reads only. runNext is called by a separate worker. */
export class VacancyMechanicsRuntime {
  readonly database: DatabaseSync;
  readonly requirements: SqliteVacancyRequirementsStore;
  readonly fit: SqliteVacancyFitStore;
  constructor(databasePath: string, encryptionKey: Buffer, private readonly validateCurrentProfile?: (input: VacancyFitInput) => boolean) {
    this.database = new DatabaseSync(databasePath);
    applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
    this.requirements = new SqliteVacancyRequirementsStore(this.database);
    this.fit = new SqliteVacancyFitStore(this.database, new SealedText(encryptionKey));
  }
  view(input: VacancyFitInput): VacancyFitView {
    const extracted = this.requirements.getLatest(input.vacancyId, vacancyDescriptionHash(input.description));
    const resolved = { ...input, requirements: extracted?.requirements ?? [] };
    const result = this.fit.getCache(resolved);
    const queued = this.fit.getJobState(input) ?? this.fit.getJobState(resolved);
    const state = !input.description.trim() ? 'no_description'
      : extracted?.status === 'no_requirements' ? 'no_requirements' : result ? 'ready'
        : queued === 'failed' ? 'failed' : queued === 'pending' || queued === 'leased' ? 'processing' : 'not_requested';
    return { state, requirements: resolved.requirements, ...(result ? { result } : {}) };
  }
  cachedVacancyIds(candidateId: string): Set<string> { return this.fit.cachedVacancyIds(candidateId); }
  enqueue(input: VacancyFitInput) {
    const requirementInput = { vacancyId: input.vacancyId, description: input.description };
    // This method is reached only by an explicit authenticated POST, never by the worker retry loop.
    this.requirements.retryFailed(requirementInput);
    this.requirements.enqueue(requirementInput, { titleStrategyPriority: 1 });
    this.fit.retryFailed(input);
    return this.fit.enqueue(input);
  }
  deleteCandidate(candidateId: string) { this.fit.deleteCandidate(candidateId); }
  close() { this.database.close(); }

  async runNext(client: BulkLlmClient | null, workerId = 'vacancy-mechanics'): Promise<boolean> {
    const extracted = await this.requirements.runNext(workerId, (input) => extractVacancyRequirementsWithFallback(input,
      client ? { extract: async ({ description, instructions }) => (await client.complete({
        runId: workerId, task: 'vacancy-requirements', dataClass: 'public', prefix: instructions,
        input: minimizeModelText(description), maxTokens: 2048,
      })).content } : undefined));
    const job = this.fit.claim({ leaseMs: 300000 });
    if (!job) return Boolean(extracted);
    try {
      const requirements = this.requirements.getLatest(job.input.vacancyId, vacancyDescriptionHash(job.input.description));
      if (!requirements) {
        const dependency = this.requirements.enqueue({ vacancyId: job.input.vacancyId, description: job.input.description });
        if (dependency.state === 'failed') this.fit.fail(job);
        else this.fit.defer(job);
        return Boolean(extracted);
      }
      const resolved = { ...job.input, requirements: requirements.requirements };
      let staleProfile = false;
      let assessmentReturned = false;
      const base = client ? createVacancyFitAssessor(client, workerId) : undefined;
      const assessor = base ? { assess: async (input: Parameters<typeof base.assess>[0]) => {
        if (!this.validateCurrentProfile?.(resolved)) { staleProfile = true; throw new Error('profile_changed'); }
        const assessments = await base.assess(input);
        assessmentReturned = true;
        return assessments;
      } } : undefined;
      const result = await assessVacancyFit(resolved, assessor);
      if (client && result.reason === 'assessment_unavailable' && !assessmentReturned) {
        this.fit.fail(job, { retry: Boolean(client) && !staleProfile && job.attempts < 3 });
      } else this.fit.complete(job, result, undefined, resolved);
    } catch { this.fit.fail(job, { retry: job.attempts < 3 }); }
    return true;
  }
}
