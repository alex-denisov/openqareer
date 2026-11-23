import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SealedText } from './sealedText';
import { FIT_INPUT_TOO_LARGE, SqliteVacancyFitStore } from './sqliteVacancyFitStore';
import type { VacancyFitInput } from '../domain/vacancyFit';

const now = '2026-11-22T10:00:00.000Z';
const later = '2026-11-22T11:00:00.000Z';
const input: VacancyFitInput = {
  candidateId: 'candidate-a',
  vacancyId: 'vacancy',
  description: 'TypeScript required.',
  requirements: [],
  facts: [],
  checkedFactIds: [],
  gates: {} as VacancyFitInput['gates'],
  assessments: [],
};

function failedWith(reason: string) {
  const store = new SqliteVacancyFitStore(new DatabaseSync(':memory:'), new SealedText(Buffer.alloc(32, 7)));
  store.enqueue(input, now);
  const job = store.claim({ now })!;
  expect(store.fail(job, { retry: false, reason, now })).toBe(true);
  return store;
}

describe('B757: a fit too large for one call is not asked again', () => {
  it('a new fit request leaves the final refusal as it is', () => {
    const store = failedWith(FIT_INPUT_TOO_LARGE);
    store.retryFailed(input, later);
    expect(store.getJobStatus(input)).toEqual({ state: 'failed', lastError: FIT_INPUT_TOO_LARGE });
    expect(store.claim({ now: later })).toBeUndefined();
  });

  it('any other failure goes back to the queue as before', () => {
    const store = failedWith('assessment_model_unavailable');
    store.retryFailed(input, later);
    expect(store.getJobStatus(input)?.state).toBe('pending');
  });
});

describe('a job superseded by a profile change goes instead of staying failed', () => {
  it('discard deletes the leased row only for its own lease', () => {
    const store = new SqliteVacancyFitStore(new DatabaseSync(':memory:'), new SealedText(Buffer.alloc(32, 7)));
    store.enqueue(input, now);
    const job = store.claim({ now })!;
    expect(store.discard({ ...job, leaseToken: 'other' }, now)).toBe(false);
    expect(store.discard(job, now)).toBe(true);
    expect(store.getJobStatus(input)).toBeUndefined();
    expect(store.enqueue(input, later).status).toBe('pending');
  });

  it('purgeSuperseded removes old profile_changed rows up to the limit and nothing else', () => {
    const database = new DatabaseSync(':memory:');
    const store = new SqliteVacancyFitStore(database, new SealedText(Buffer.alloc(32, 7)));
    const insert = database.prepare(`INSERT INTO vacancy_fit_queue(cache_key,candidate_key,input_cipher,status,created_at,updated_at,last_error)
      VALUES(?,'c','cipher',?,?,?,?)`);
    for (let index = 0; index < 45; index += 1) insert.run(`s${index}`, 'failed', now, now, 'profile_changed');
    insert.run('other-failed', 'failed', now, now, 'assessment_model_unavailable');
    insert.run('waiting', 'pending', now, now, 'profile_changed');
    expect(store.purgeSuperseded(30)).toBe(30);
    expect(store.purgeSuperseded()).toBe(15);
    expect(store.purgeSuperseded()).toBe(0);
    const left = database.prepare('SELECT cache_key FROM vacancy_fit_queue ORDER BY cache_key').all().map((row) => row.cache_key);
    expect(left).toEqual(['other-failed', 'waiting']);
  });
});
