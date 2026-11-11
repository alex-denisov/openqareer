import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const DAY = 24 * 60 * 60 * 1000;
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((done) => done()));

function open() {
  const directory = mkdtempSync(join(tmpdir(), 'pool-seen-'));
  const path = join(directory, 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path });
  const read = new DatabaseSync(path);
  cleanup.push(() => {
    read.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, read };
}

function vacancy(
  id: string,
  sourceId: string,
  publishedAgo: number,
  seenAgo: number,
): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `VP Engineering ${id}`,
    company: 'Acme',
    isRemote: true,
    description: 'Executive search.',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: `https://example.test/${id}`,
      observedAt: new Date(Date.now() - seenAgo * DAY).toISOString(),
    },
    publishedAt: new Date(Date.now() - publishedAgo * DAY).toISOString(),
    status: 'active',
  };
}

function seen(read: DatabaseSync, id: string) {
  return read
    .prepare('SELECT first_seen_ms, observed_ms FROM vacancy_pool_index WHERE id = ?')
    .get(id) as { first_seen_ms: number; observed_ms: number } | undefined;
}

describe('первое и последнее чтение записи (B642)', () => {
  it('повторное чтение двигает последнее, а первое остаётся', () => {
    const { store, read } = open();
    const first = vacancy('a', 'ats-greenhouse-acme', 60, 3);
    store.replaceSourceSlice('ats-greenhouse-acme', [first]);
    const again = vacancy('a', 'ats-greenhouse-acme', 60, 0);
    store.replaceSourceSlice('ats-greenhouse-acme', [again]);
    const row = seen(read, 'a');
    expect(row?.first_seen_ms).toBe(Date.parse(first.provenance.observedAt));
    expect(row?.observed_ms).toBe(Date.parse(again.provenance.observedAt));
  });
});

describe('уборка по последнему чтению (B642)', () => {
  it('держит старую живую запись работодателя, снимает невиденную неделю и старую с агрегатора', () => {
    const { store, read } = open();
    store.replaceSourceSlice('ats-greenhouse-acme', [
      vacancy('alive', 'ats-greenhouse-acme', 90, 1),
      vacancy('gone', 'ats-greenhouse-acme', 20, 8),
    ]);
    store.replaceSourceSlice('src-himalayas-api', [vacancy('agg', 'src-himalayas-api', 40, 0)]);
    fullReadAt(read, 'ats-greenhouse-acme', Date.now() - DAY);
    store.prune(
      ['ats-greenhouse-acme', 'src-himalayas-api'],
      new Date(Date.now() - 30 * DAY).toISOString(),
    );
    const ids = (
      read.prepare('SELECT id FROM vacancy_pool ORDER BY id').all() as Array<{ id: string }>
    ).map((row) => row.id);
    expect(ids).toEqual(['alive']);
  });
});

function fullReadAt(read: DatabaseSync, sourceId: string, atMs: number | null): void {
  read.prepare(`INSERT INTO company_placement (placement_id, type, priority, source_id, discovered_by, updated_at, last_full_read_at)
    VALUES (?, 'ats', 2, ?, 'source', 0, ?)`).run(`ats:${sourceId}`, sourceId, atMs);
}

describe('B643-6: невиденная запись снимается только после полного чтения', () => {
  const prune = (store: SqliteVacancyPoolStore) =>
    store.prune(['ats-greenhouse-acme'], new Date(Date.now() - 30 * DAY).toISOString());
  const ids = (read: DatabaseSync) =>
    (read.prepare('SELECT id FROM vacancy_pool ORDER BY id').all() as Array<{ id: string }>).map((row) => row.id);

  it('keeps a row unseen 8 days when the board was not fully read since', () => {
    const { store, read } = open();
    store.replaceSourceSlice('ats-greenhouse-acme', [vacancy('paused', 'ats-greenhouse-acme', 20, 8)]);
    fullReadAt(read, 'ats-greenhouse-acme', Date.now() - 9 * DAY);
    prune(store);
    expect(ids(read)).toEqual(['paused']);
  });

  it('keeps it without any placement row too', () => {
    const { store, read } = open();
    store.replaceSourceSlice('ats-greenhouse-acme', [vacancy('unknown', 'ats-greenhouse-acme', 20, 8)]);
    prune(store);
    expect(ids(read)).toEqual(['unknown']);
  });

  it('drops a row unseen 30 days even without a full read: the board stopped reading', () => {
    const { store, read } = open();
    store.replaceSourceSlice('ats-greenhouse-acme', [vacancy('dead', 'ats-greenhouse-acme', 20, 31)]);
    prune(store);
    expect(ids(read)).toEqual([]);
  });
});

describe('журнал удалённых по отсутствию в полном чтении (B642)', () => {
  it('пишет источник, id и ссылку каждой снятой записи', () => {
    const { store } = open();
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    store.replaceSourceSlice('ats-greenhouse-acme', [
      vacancy('keep', 'ats-greenhouse-acme', 5, 0),
      vacancy('closed', 'ats-greenhouse-acme', 5, 0),
    ]);
    store.replaceSourceSlice('ats-greenhouse-acme', [vacancy('keep', 'ats-greenhouse-acme', 5, 0)]);
    spy.mockRestore();
    const removed = lines
      .map((line) => JSON.parse(line))
      .filter((e) => e.event === 'pool_absent_removed');
    expect(removed).toEqual([
      {
        event: 'pool_absent_removed',
        sourceId: 'ats-greenhouse-acme',
        id: 'closed',
        url: 'https://example.test/closed',
      },
    ]);
  });
});
