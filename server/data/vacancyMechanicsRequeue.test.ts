import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SealedText } from './sealedText';
import { SqliteVacancyFitStore } from './sqliteVacancyFitStore';
import { SqliteVacancyRequirementsStore } from './sqliteVacancyRequirementsStore';
import type { VacancyFitInput } from '../domain/vacancyFit';

const unknown = { status: 'unknown', reason: 'unknown' } as const;
const fitInput = (vacancyId: string): VacancyFitInput => ({ candidateId: 'c', vacancyId, description: `${vacancyId} text`, requirements: [], facts: [],
  gates: { role: unknown, level: unknown, region: unknown, workFormat: unknown, workAuthorization: unknown } });

function failRequirement(store: SqliteVacancyRequirementsStore, vacancyId: string, code: string, now: number) {
  store.enqueue({ vacancyId, description: `${vacancyId} text` }, { now });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const job = store.claim('w', now + attempt * 100_000, 60_000)!;
    store.fail(job, code, now + attempt * 100_000);
  }
}

describe('one requeue of model failures after a parser upgrade (B522)', () => {
  it('requeues failed model extractions once, never above shown pages, and leaves other failures alone', () => {
    const database = new DatabaseSync(':memory:');
    const store = new SqliteVacancyRequirementsStore(database);
    const now = Date.parse('2026-10-21T05:00:00Z');
    failRequirement(store, 'invalid', 'requirements_model_invalid', now);
    failRequirement(store, 'down', 'requirements_model_unavailable', now);
    failRequirement(store, 'other', 'requirements_result_identity_mismatch', now);
    // Simulate rows that failed before the revision column existed.
    database.exec('UPDATE vacancy_requirements_jobs SET requeue_revision=NULL');
    expect(store.requeueModelFailures(2, now + 1e6)).toBe(2);
    expect(store.requeueModelFailures(2, now + 2e6)).toBe(0);
    store.enqueue({ vacancyId: 'shown', description: 'shown text' }, { titleStrategyPriority: 2, now: now + 2e6 });
    expect(store.claim('w', now + 3e6)?.input.vacancyId).toBe('shown');
    database.close();
  });

  it('a failure under the new revision is never requeued again', () => {
    const database = new DatabaseSync(':memory:');
    const store = new SqliteVacancyRequirementsStore(database);
    const now = Date.parse('2026-10-21T05:00:00Z');
    store.requeueModelFailures(2, now);
    failRequirement(store, 'later', 'requirements_model_invalid', now);
    expect(store.requeueModelFailures(2, now + 1e6)).toBe(0);
    database.close();
  });

  it('requeues jobs failed under the strict B510 parser once, keeping label upgrades at 0.1 and shown pages at 1.5 (B510-r)', () => {
    const database = new DatabaseSync(':memory:');
    const store = new SqliteVacancyRequirementsStore(database);
    const now = Date.parse('2026-10-22T03:00:00Z');
    failRequirement(store, 'upgrade', 'requirements_model_invalid', now);
    failRequirement(store, 'shown', 'requirements_model_invalid', now);
    database.exec(`UPDATE vacancy_requirements_jobs SET requeue_revision=2, priority=CASE json_extract(input_json,'$.vacancyId') WHEN 'upgrade' THEN 0.1 ELSE 1.5 END`);
    expect(store.requeueModelFailures(undefined, now + 1e6)).toBe(2);
    expect(store.requeueModelFailures(undefined, now + 2e6)).toBe(0);
    const priorities = database.prepare(`SELECT json_extract(input_json,'$.vacancyId') id, priority FROM vacancy_requirements_jobs ORDER BY id`).all();
    expect(priorities).toEqual([{ id: 'shown', priority: 1.5 }, { id: 'upgrade', priority: 0.1 }]);
    database.close();
  });

  it('requeues failed fit jobs once with an old request time, so shown pages stay first', () => {
    const database = new DatabaseSync(':memory:');
    const fit = new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7)));
    fit.enqueue(fitInput('old'), '2026-10-21T03:00:00.000Z');
    const job = fit.claim({ now: '2026-10-21T03:00:01.000Z' })!;
    fit.fail(job, { now: '2026-10-21T03:00:01.000Z', reason: 'requirements_failed' });
    database.exec('UPDATE vacancy_fit_queue SET requeue_revision=NULL');
    expect(fit.requeueFailedOnce(2, '2026-10-21T08:00:00.000Z')).toBe(1);
    expect(fit.requeueFailedOnce(2, '2026-10-21T08:00:01.000Z')).toBe(0);
    expect(fit.getJobState(fitInput('old'))).toBe('pending');
    fit.enqueue(fitInput('shown'), '2026-10-21T08:00:02.000Z');
    expect(fit.claim({ now: '2026-10-21T08:00:03.000Z' })?.input.vacancyId).toBe('shown');
    const again = fit.claim({ now: '2026-10-21T08:00:03.000Z' })!;
    expect(again.input.vacancyId).toBe('old');
    fit.fail(again, { now: '2026-10-21T08:00:04.000Z', reason: 'requirements_failed' });
    expect(fit.requeueFailedOnce(2, '2026-10-21T09:00:00.000Z')).toBe(0);
    database.close();
  });

  it('requeues on the next worker start what failed before the B562-r quote fix: requirements and their fits', () => {
    const database = new DatabaseSync(':memory:');
    const store = new SqliteVacancyRequirementsStore(database);
    const fit = new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7)));
    const now = Date.parse('2026-10-25T12:00:00Z');
    failRequirement(store, 'french', 'requirements_model_invalid', now);
    fit.enqueue(fitInput('french'), '2026-10-25T12:00:00.000Z');
    fit.fail(fit.claim({ now: '2026-10-25T12:00:01.000Z' })!, { now: '2026-10-25T12:00:01.000Z', reason: 'requirements_failed' });
    // Both rows were written by the 25.10 release, under revision 3.
    database.exec('UPDATE vacancy_requirements_jobs SET requeue_revision=3; UPDATE vacancy_fit_queue SET requeue_revision=3');
    expect(store.requeueModelFailures(undefined, now + 1e6)).toBe(1);
    expect(fit.requeueFailedOnce(undefined, '2026-10-25T13:00:00.000Z')).toBe(1);
    expect(fit.getJobState(fitInput('french'))).toBe('pending');
    database.close();
  });
});
