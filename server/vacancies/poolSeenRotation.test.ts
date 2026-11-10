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
