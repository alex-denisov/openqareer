import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore, type PoolWriteEvent } from './sqliteVacancyPoolStore';

const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});


describe('SqliteVacancyPoolStore · порционная замена среза (PRB-043)', () => {
  function card(
    id: string,
    sourceId = 'src',
  ): Parameters<SqliteVacancyPoolStore['replaceSourceSlice']>[1][number] {
    return {
      id,
      fingerprint: `fp-${id}`,
      title: 'Role',
      company: 'Company',
      description: '',
      requiredSkills: [],
      url: `https://example.test/${id}`,
      provenance: {
        sourceType: 'json_api',
        sourceId,
        sourceUrl: `https://example.test/${id}`,
        observedAt: '2026-09-01T10:00:00.000Z',
      },
      publishedAt: '2026-09-01T10:00:00.000Z',
      status: 'active',
    };
  }

  function openChunked(writeChunkSize: number, onWrite?: (event: PoolWriteEvent) => void) {
    const directory = mkdtempSync(join(tmpdir(), 'vacancy-pool-store-'));
    directories.push(directory);
    const path = join(directory, 'pool.db');
    const store = new SqliteVacancyPoolStore({
      databasePath: path,
      writeChunkSize,
      ...(onWrite ? { onWrite } : {}),
    });
    stores.push(store);
    return { store, path };
  }

  it('пишет срез транзакциями не больше порции и снимает ушедшее порциями по id', () => {
    const events: PoolWriteEvent[] = [];
    const { store } = openChunked(2, (event) => events.push(event));
    store.replaceSourceSlice('src', ['a', 'b', 'c', 'd', 'e'].map((id) => card(id)));
    events.length = 0;

    store.replaceSourceSlice('src', ['a', 'f'].map((id) => card(id)));

    const transactions = events.filter((event) => event.kind === 'transaction');
    expect(transactions.every((event) => event.rows <= 2)).toBe(true);
    expect(transactions.filter((event) => event.operation === 'upsert').map((e) => e.rows)).toEqual([2]);
    // Ушли b, c, d, e — две порции по два id.
    expect(transactions.filter((event) => event.operation === 'remove').map((e) => e.rows)).toEqual([2, 2]);
    const summary = events.find((event) => event.kind === 'slice');
    expect(summary).toMatchObject({ operation: 'replace', sourceId: 'src', upserted: 2, removed: 4, transactions: 3 });
    expect(store.loadVacancies().map((v) => v.id).sort()).toEqual(['a', 'f']);
  });

  it('не трогает чужой источник и похороненные записи при порционном снятии', () => {
    const { store, path } = openChunked(2);
    store.replaceSourceSlice('src', ['a', 'b', 'c'].map((id) => card(id)));
    store.replaceSourceSlice('other', ['x', 'y'].map((id) => card(id, 'other')));
    store.markExpired(['c'], '2026-09-07T09:00:00.000Z');

    store.replaceSourceSlice('src', [card('d')]);

    expect(store.loadVacancies().map((v) => v.id).sort()).toEqual(['d', 'x', 'y']);
    // Похороненная запись пережила замену: доказательство смерти не стирается.
    const buried = new DatabaseSync(path)
      .prepare('SELECT expired_at FROM vacancy_pool WHERE id = ?')
      .get('c') as { expired_at: string | null } | undefined;
    expect(buried?.expired_at).toBe('2026-09-07T09:00:00.000Z');
  });

  it('доделывает замену, прерванную между порциями, следующим вызовом', () => {
    let failOnTransaction = Number.POSITIVE_INFINITY;
    const { store } = openChunked(2, (event) => {
      if (event.kind === 'transaction' && --failOnTransaction === 0) throw new Error('interrupted');
    });
    store.replaceSourceSlice('src', ['a', 'b', 'c'].map((id) => card(id)));

    // Первая порция нового среза зафиксирована, на второй процесс упал:
    // пул — надмножество старого и нового, ничего не потеряно.
    failOnTransaction = 2;
    expect(() => store.replaceSourceSlice('src', ['a', 'd', 'e'].map((id) => card(id)))).toThrow(
      'interrupted',
    );
    expect(store.loadVacancies().map((v) => v.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);

    failOnTransaction = Number.POSITIVE_INFINITY;
    store.replaceSourceSlice('src', ['a', 'd', 'e'].map((id) => card(id)));
    expect(store.loadVacancies().map((v) => v.id).sort()).toEqual(['a', 'd', 'e']);
  });
});
