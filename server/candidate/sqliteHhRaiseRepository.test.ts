import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteHhRaiseRepository } from './sqliteHhRaiseRepository';

let dir = '';
let databasePath = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hh-raise-'));
  databasePath = join(dir, 'db.sqlite');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('B699: удачные поднятия за день', () => {
  it('считает исход ok, но не отказ, пропавший клиент и чужие задания', () => {
    const repository = new SqliteHhRaiseRepository({ databasePath });
    const raise = (candidate: string, at: string, outcome: 'ok' | 'too_early' | null) => {
      repository.enqueue(candidate, 'r', at);
      const task = repository.claim(candidate, at)!;
      if (outcome) repository.finish(candidate, task.id, at, outcome);
      else repository.releaseStale(at, at);
    };
    raise('c', '2026-11-25T00:06:00.000Z', 'ok');
    raise('c', '2026-11-25T04:16:00.000Z', 'ok');
    raise('c', '2026-11-25T08:16:00.000Z', 'too_early');
    raise('c', '2026-11-25T09:16:00.000Z', null);
    raise('other', '2026-11-25T04:16:00.000Z', 'ok');
    expect(repository.raisedAt('c', '2026-11-25T00:00:00.000Z')).toHaveLength(2);
    expect(repository.raisedAt('c', '2026-11-25T01:00:00.000Z')).toHaveLength(1);
    repository.close();
  });

  it('прежняя таблица без исхода получает столбец, закрытое взятое задание — поднятие', () => {
    const old = new DatabaseSync(databasePath);
    old.exec(`CREATE TABLE hh_raise_tasks (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL,
      resume_id TEXT NOT NULL, status TEXT NOT NULL, queued_at TEXT NOT NULL, claimed_at TEXT,
      finished_at TEXT) STRICT;
      INSERT INTO hh_raise_tasks VALUES ('t', 'c', 'r', 'done', '2026-11-25T00:00:00.000Z',
        '2026-11-25T00:01:00.000Z', '2026-11-25T00:06:00.000Z');`);
    old.close();
    const repository = new SqliteHhRaiseRepository({ databasePath });
    expect(repository.raisedAt('c', '2026-11-25T00:00:00.000Z')).toHaveLength(1);
    repository.close();
  });
});
