import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteVacancyPoolStore, type PoolWriteEvent } from './sqliteVacancyPoolStore';

const stores: SqliteVacancyPoolStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function card(id: string) {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: 'Role',
    company: 'Company',
    description: '',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api' as const,
      sourceId: 'src',
      sourceUrl: `https://example.test/${id}`,
      observedAt: '2026-09-01T10:00:00.000Z',
    },
    publishedAt: '2026-09-01T10:00:00.000Z',
    status: 'active' as const,
  };
}

function storeWith(options: { writeBudgetMs?: number }) {
  const events: PoolWriteEvent[] = [];
  const store = new SqliteVacancyPoolStore({
    databasePath: join(mkdtempSync(join(tmpdir(), 'pool-budget-')), 'pool.db'),
    onWrite: (event) => events.push(event),
    ...options,
  });
  stores.push(store);
  const transactions = () => events.filter((event) => event.kind === 'transaction');
  return { store, transactions };
}

describe('pool write budget (PRB-041: a 100-row hh upsert held the write lock 21 s, the web waited 15 s)', () => {
  it('commits as soon as a transaction spends its time budget, within one chunk', async () => {
    const { store, transactions } = storeWith({ writeBudgetMs: 0 });

    await store.replaceSourceSliceAsync?.('src', ['a', 'b', 'c'].map(card));

    expect(transactions().map((event) => event.rows)).toEqual([1, 1, 1]);
    expect(
      store
        .loadVacancies()
        .map((vacancy) => vacancy.id)
        .sort(),
    ).toEqual(['a', 'b', 'c']);
  });

  it('keeps a fast chunk in one transaction and reports the lock wait apart from the work', () => {
    const { store, transactions } = storeWith({});

    store.replaceSourceSlice('src', ['a', 'b', 'c'].map(card));

    const upserts = transactions().filter(
      (event) => event.kind === 'transaction' && event.operation === 'upsert',
    );
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ rows: 3, lockWaitMs: expect.any(Number) });
  });
});
