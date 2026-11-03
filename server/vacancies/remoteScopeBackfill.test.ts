import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { runRemoteScopeBackfillBatch } from './remoteScopeBackfill';

function vacancy(id: string, location: string, isRemote: boolean, description = '') {
  return {
    id,
    fingerprint: id,
    title: 'Infrastructure Manager',
    company: 'TIDI Products, LLC',
    location,
    isRemote,
    description,
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: { sourceId: 'src-indeed', observedAt: '2026-11-01T00:00:00.000Z' },
    publishedAt: '2026-11-01T00:00:00.000Z',
    status: 'active',
  };
}

function seeded(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE vacancy_pool (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE vacancy_pool_index (id TEXT PRIMARY KEY, is_remote INTEGER, expired INTEGER NOT NULL);
    CREATE TABLE vacancy_cluster_input (id TEXT PRIMARY KEY, cluster_json TEXT NOT NULL);
  `);
  const rows = [
    vacancy('tidi', 'Remote', true, 'This role can work remotely anywhere in the US.'),
    vacancy('office', 'Berlin', false),
    vacancy('moscow', 'Москва', true),
    vacancy('expired', 'Remote', true),
  ];
  for (const row of rows) {
    database.prepare('INSERT INTO vacancy_pool VALUES (?, ?)').run(row.id, JSON.stringify(row));
    database
      .prepare('INSERT INTO vacancy_pool_index VALUES (?, ?, ?)')
      .run(row.id, row.isRemote ? 1 : 0, row.id === 'expired' ? 1 : 0);
    database
      .prepare('INSERT INTO vacancy_cluster_input VALUES (?, ?)')
      .run(row.id, JSON.stringify({ id: row.id, location: row.location }));
  }
  return database;
}

const scopeOf = (database: DatabaseSync, id: string) =>
  (
    JSON.parse(
      (
        database.prepare('SELECT cluster_json FROM vacancy_cluster_input WHERE id = ?').get(id) as {
          cluster_json: string;
        }
      ).cluster_json,
    ) as { remoteScope?: string }
  ).remoteScope;

describe('remote scope backfill', () => {
  it('rewrites only live remote projections, in batches, and then stops', () => {
    const database = seeded();
    expect(runRemoteScopeBackfillBatch(database, 1)).toEqual({
      scanned: 1,
      updated: 1,
      completed: false,
    });
    expect(runRemoteScopeBackfillBatch(database, 1)).toEqual({
      scanned: 1,
      updated: 1,
      completed: false,
    });
    expect(runRemoteScopeBackfillBatch(database, 1).completed).toBe(true);
    expect(scopeOf(database, 'tidi')).toBe('US');
    expect(scopeOf(database, 'moscow')).toBe('RU');
    expect(scopeOf(database, 'office')).toBeUndefined();
    expect(scopeOf(database, 'expired')).toBeUndefined();
    expect(runRemoteScopeBackfillBatch(database, 1)).toEqual({
      scanned: 0,
      updated: 0,
      completed: true,
    });
  });

  it('skips projections that already carry a scope', () => {
    const database = seeded();
    database
      .prepare('UPDATE vacancy_cluster_input SET cluster_json = ? WHERE id = ?')
      .run(JSON.stringify({ id: 'tidi', remoteScope: 'global' }), 'tidi');
    expect(runRemoteScopeBackfillBatch(database, 10)).toEqual({
      scanned: 2,
      updated: 1,
      completed: false,
    });
    expect(scopeOf(database, 'tidi')).toBe('global');
  });
});
