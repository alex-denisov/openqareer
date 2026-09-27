import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteSearchConsentRepository } from './sqliteSearchConsentRepository';

describe('SqliteSearchConsentRepository', () => {
  function createRepo(): SqliteSearchConsentRepository {
    const db = new DatabaseSync(':memory:');
    return new SqliteSearchConsentRepository(db);
  }

  it('returns not granted for a candidate with no record yet', () => {
    const repo = createRepo();
    const state = repo.get('cand-1');
    expect(state.granted).toBe(false);
    expect(state.policyVersion).toBe('');
  });

  it('stores a granted consent and returns it back', () => {
    const repo = createRepo();
    repo.set('cand-1', { granted: true, policyVersion: 'v1' });
    const state = repo.get('cand-1');
    expect(state.granted).toBe(true);
    expect(state.policyVersion).toBe('v1');
    expect(state.updatedAt).toBeTruthy();
  });

  it('overwrites an earlier decision instead of duplicating rows', () => {
    const repo = createRepo();
    repo.set('cand-1', { granted: true, policyVersion: 'v1' });
    repo.set('cand-1', { granted: false, policyVersion: 'v1' });
    const state = repo.get('cand-1');
    expect(state.granted).toBe(false);
  });

  it('keeps consent decisions of different candidates separate', () => {
    const repo = createRepo();
    repo.set('cand-1', { granted: true, policyVersion: 'v1' });
    const other = repo.get('cand-2');
    expect(other.granted).toBe(false);
  });
});
