import { describe, expect, it } from 'vitest';
import { SqliteTitleParseStore } from './sqliteTitleParseStore';

describe('SqliteTitleParseStore (B267 S1)', () => {
  it('round-trips a rules-parsed entry', () => {
    const store = new SqliteTitleParseStore({ databasePath: ':memory:' });

    store.insertIfMissing({
      titleKey: 'cto',
      sampleTitle: 'CTO',
      functions: ['eng-mgmt'],
      levelRank: 4,
      roleLabel: null,
      parsedBy: 'rules',
      model: null,
      taxonomyVersion: 1,
      priority: 0,
    });

    const stored = store.getByKey('cto');
    expect(stored).toMatchObject({
      titleKey: 'cto',
      sampleTitle: 'CTO',
      functions: ['eng-mgmt'],
      levelRank: 4,
      parsedBy: 'rules',
      taxonomyVersion: 1,
    });
  });

  it('is missing for an unknown key', () => {
    const store = new SqliteTitleParseStore({ databasePath: ':memory:' });
    expect(store.getByKey('unknown')).toBeUndefined();
  });

  it('never overwrites an existing row (insertIfMissing is idempotent)', () => {
    const store = new SqliteTitleParseStore({ databasePath: ':memory:' });
    store.insertIfMissing({
      titleKey: 'cto',
      sampleTitle: 'CTO',
      functions: ['eng-mgmt'],
      levelRank: 4,
      roleLabel: null,
      parsedBy: 'rules',
      model: null,
      taxonomyVersion: 1,
      priority: 0,
    });
    // A model result for the same key must not be clobbered by a later rules pass.
    store.insertIfMissing({
      titleKey: 'cto',
      sampleTitle: 'CTO',
      functions: ['exec-general'],
      levelRank: 4,
      roleLabel: 'Chief Technology Officer',
      parsedBy: 'model',
      model: 'gpt-test',
      taxonomyVersion: 1,
      priority: 0,
    });

    expect(store.getByKey('cto')?.parsedBy).toBe('rules');
    expect(store.getByKey('cto')?.functions).toEqual(['eng-mgmt']);
  });

  it('stores a null levelRank as unknown level', () => {
    const store = new SqliteTitleParseStore({ databasePath: ':memory:' });
    store.insertIfMissing({
      titleKey: 'developer',
      sampleTitle: 'Developer',
      functions: ['eng'],
      levelRank: null,
      roleLabel: null,
      parsedBy: 'rules',
      model: null,
      taxonomyVersion: 1,
      priority: 0,
    });
    expect(store.getByKey('developer')?.levelRank).toBeNull();
  });
});
