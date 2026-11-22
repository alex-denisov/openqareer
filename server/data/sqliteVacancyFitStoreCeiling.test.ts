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
