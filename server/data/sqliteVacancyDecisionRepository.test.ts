import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteVacancyDecisionRepository } from './sqliteVacancyDecisionRepository';

function openRepository(): SqliteVacancyDecisionRepository {
  const database = new DatabaseSync(':memory:');
  return new SqliteVacancyDecisionRepository(database);
}

describe('SqliteVacancyDecisionRepository (B248)', () => {
  it('creates its table with CREATE TABLE IF NOT EXISTS and stays usable on a second open', () => {
    const database = new DatabaseSync(':memory:');
    const repository1 = new SqliteVacancyDecisionRepository(database);
    const repository2 = new SqliteVacancyDecisionRepository(database);
    repository1.record('cand-1', { clusterId: 'cluster-1', status: 'saved' });
    expect(repository2.list('cand-1')).toHaveLength(1);
  });

  it('records a saved decision without a skip reason', () => {
    const repository = openRepository();
    const decision = repository.record('cand-1', { clusterId: 'cluster-1', status: 'saved' });
    expect(decision).toMatchObject({ clusterId: 'cluster-1', status: 'saved', skipReasonId: null });
    expect(repository.list('cand-1')).toEqual([decision]);
  });

  it('records a skipped decision with a reason from the shared registry', () => {
    const repository = openRepository();
    const decision = repository.record('cand-1', {
      clusterId: 'cluster-1',
      status: 'skipped',
      skipReasonId: 'comp-below',
    });
    expect(decision.skipReasonId).toBe('comp-below');
  });

  it('refuses a skipped decision with an unknown reason id', () => {
    const repository = openRepository();
    expect(() =>
      repository.record('cand-1', {
        clusterId: 'cluster-1',
        status: 'skipped',
        // @ts-expect-error — deliberately not a registered reason id
        skipReasonId: 'not-a-real-reason',
      }),
    ).toThrow();
  });

  it('refuses a skipped decision with no reason at all', () => {
    const repository = openRepository();
    expect(() =>
      repository.record('cand-1', { clusterId: 'cluster-1', status: 'skipped' }),
    ).toThrow();
  });

  it('is idempotent per candidate + cluster: the later decision replaces the earlier one', () => {
    const repository = openRepository();
    repository.record('cand-1', { clusterId: 'cluster-1', status: 'saved' });
    repository.record('cand-1', {
      clusterId: 'cluster-1',
      status: 'skipped',
      skipReasonId: 'stale',
    });
    const decisions = repository.list('cand-1');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ status: 'skipped', skipReasonId: 'stale' });
  });

  it('scopes decisions to the candidate that made them', () => {
    const repository = openRepository();
    repository.record('cand-1', { clusterId: 'cluster-1', status: 'saved' });
    repository.record('cand-2', { clusterId: 'cluster-1', status: 'saved' });
    expect(repository.list('cand-1')).toHaveLength(1);
    expect(repository.list('cand-2')).toHaveLength(1);
  });
});
