import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SealedText } from './sealedText';
import { SqliteVacancyFitStore } from './sqliteVacancyFitStore';
import type { VacancyFitInput } from '../domain/vacancyFit';

function input(vacancyId: string): VacancyFitInput {
  const unknown = { status: 'unknown', reason: 'unknown' } as const;
  return {
    candidateId: 'candidate-a', vacancyId, description: `${vacancyId} TypeScript required`, requirements: [], facts: [],
    gates: { role: unknown, level: unknown, region: unknown, workFormat: unknown, workAuthorization: unknown },
  };
}
function setup() {
  const database = new DatabaseSync(':memory:');
  return { database, store: new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7))) };
}
const at = (seconds: number) => new Date(Date.parse('2026-10-21T04:00:00.000Z') + seconds * 1000).toISOString();

describe('vacancy fit queue order (B524 return)', () => {
  it('a job waiting for requirements does not block the rest of the queue (prod 21.10: 1229 of 1230 never claimed)', () => {
    const { database, store } = setup();
    store.enqueue(input('next'), at(0));
    store.enqueue(input('blocked'), at(1));
    const head = store.claim({ now: at(10) })!;
    expect(head.input.vacancyId).toBe('blocked');
    expect(store.defer(head, at(10))).toBe('deferred');
    // The worker step is slower than the defer pause: the deferred head must not win again.
    expect(store.claim({ now: at(200) })?.input.vacancyId).toBe('next');
    database.close();
  });

  it('the page the candidate is looking at now goes first, even if older work is queued', () => {
    const { database, store } = setup();
    store.enqueue(input('old-1'), at(0));
    store.enqueue(input('old-2'), at(1));
    store.enqueue(input('shown'), at(2));
    store.enqueue(input('old-1'), at(50));
    expect(store.claim({ now: at(60) })?.input.vacancyId).toBe('old-1');
    expect(store.claim({ now: at(60) })?.input.vacancyId).toBe('shown');
    database.close();
  });

  it('gives up waiting for requirements after a bounded number of defers instead of queueing forever', () => {
    const { database, store } = setup();
    store.enqueue(input('blocked'), at(0));
    let outcome = 'deferred';
    let clock = 0;
    for (let step = 0; step < 100 && outcome === 'deferred'; step += 1) {
      clock += 120;
      const job = store.claim({ now: at(clock) })!;
      outcome = store.defer(job, at(clock));
    }
    expect(outcome).toBe('failed');
    expect(store.getJobState(input('blocked'))).toBe('failed');
    database.close();
  });

  it('a model failure is retried with a growing pause and shown as retrying, not as queued', () => {
    const { database, store } = setup();
    store.enqueue(input('v'), at(0));
    const first = store.claim({ now: at(1) })!;
    expect(store.fail(first, { retry: true, now: at(1), reason: 'assessment_model_unavailable' })).toBe(true);
    expect(store.getJobState(input('v'))).toBe('retrying');
    expect(store.claim({ now: at(5) })).toBeUndefined();
    expect(store.claim({ now: at(120) })?.attempts).toBe(2);
    database.close();
  });
});

describe('vacancy fit queue migration under concurrent start (B524)', () => {
  it('two stores opening one database, the second after the columns already exist, do not throw', () => {
    const database = new DatabaseSync(':memory:');
    const sealed = new SealedText(Buffer.alloc(32, 7));
    new SqliteVacancyFitStore(database, sealed);
    expect(() => new SqliteVacancyFitStore(database, sealed)).not.toThrow();
    database.close();
  });
  it('a column added by the other process between check and ALTER is not an error', () => {
    const database = new DatabaseSync(':memory:');
    const sealed = new SealedText(Buffer.alloc(32, 7));
    new SqliteVacancyFitStore(database, sealed);
    const realPrepare = database.prepare.bind(database);
    // The racing process sees a table_info snapshot taken before the other one added the columns.
    database.prepare = ((sql: string) => sql.startsWith('PRAGMA table_info(vacancy_fit_queue)')
      ? { all: () => [] } : realPrepare(sql)) as typeof database.prepare;
    expect(() => new SqliteVacancyFitStore(database, sealed)).not.toThrow();
    database.close();
  });
});
