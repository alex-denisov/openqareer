import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((run) => run()));

function open() {
  const directory = mkdtempSync(join(tmpdir(), 'placement-health-'));
  const path = join(directory, 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path });
  const db = new DatabaseSync(path);
  cleanups.push(() => { db.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  db.prepare(`INSERT INTO company_placement (placement_id, company_key, type, priority, source_id, discovered_by, updated_at)
    VALUES ('ats:lever:acme', 'acme', 'ats', 2, 'ats-lever-acme', 'source', 0)`).run();
  const read = () => db.prepare(`SELECT health, last_checked_at, last_full_read_at FROM company_placement`).get();
  return { store, read };
}

describe('B643-5 placement health follows source state', () => {
  it('stamps health and the full read on a full reading', () => {
    const { store, read } = open();
    store.saveSourceState({ sourceId: 'ats-lever-acme', lastStatus: 'healthy', lastSyncAt: '2026-11-11T01:00:00.000Z', itemsFoundTotal: 3, itemsActiveTotal: 3, fullRead: true });
    expect(read()).toEqual({ health: 'healthy', last_checked_at: Date.parse('2026-11-11T01:00:00.000Z'), last_full_read_at: Date.parse('2026-11-11T01:00:00.000Z') });
  });
  it('keeps the last full read on a partial reading or an error', () => {
    const { store, read } = open();
    store.saveSourceState({ sourceId: 'ats-lever-acme', lastStatus: 'healthy', lastSyncAt: '2026-11-11T01:00:00.000Z', itemsFoundTotal: 3, itemsActiveTotal: 3, fullRead: true });
    store.saveSourceState({ sourceId: 'ats-lever-acme', lastStatus: 'healthy', lastSyncAt: '2026-11-11T02:00:00.000Z', itemsFoundTotal: 3, itemsActiveTotal: 3, fullRead: false });
    store.saveSourceState({ sourceId: 'ats-lever-acme', lastStatus: 'error', lastSyncAt: '2026-11-11T03:00:00.000Z', itemsFoundTotal: 3, itemsActiveTotal: 3 });
    expect(read()).toEqual({ health: 'error', last_checked_at: Date.parse('2026-11-11T03:00:00.000Z'), last_full_read_at: Date.parse('2026-11-11T01:00:00.000Z') });
  });
  it('does not touch placements of other sources and does not store the flag', () => {
    const { store, read } = open();
    store.saveSourceState({ sourceId: 'other', lastStatus: 'error', itemsFoundTotal: 0, itemsActiveTotal: 0, fullRead: true });
    expect(read()).toEqual({ health: null, last_checked_at: null, last_full_read_at: null });
    expect(store.loadSourceStates()).toEqual([{ sourceId: 'other', lastStatus: 'error', itemsFoundTotal: 0, itemsActiveTotal: 0 }]);
  });
});
