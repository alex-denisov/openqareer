import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/** Планы запросов к очереди сверки, подготовленных за время `run`. */
function livenessPlans(run: (store: SqliteVacancyPoolStore) => void): string[][] {
  const store = new SqliteVacancyPoolStore({ databasePath: ':memory:' });
  const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
  try {
    run(store);
    const database = prepare.mock.contexts[0] as DatabaseSync;
    const queries = prepare.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => sql.includes('FROM selection_liveness q'));
    prepare.mockRestore();
    return queries.map((sql) => {
      const plan = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>;
      return plan.map((row) => row.detail);
    });
  } finally {
    prepare.mockRestore();
    store.close();
  }
}

// Прод 25.11: обход индекса пула вместо очереди держал веб-процесс 120–135 с на каждой сборке подборки.
it.each([
  ['closedSelection', (store: SqliteVacancyPoolStore) => void store.closedSelection()],
  ['dueSelectionLiveness', (store: SqliteVacancyPoolStore) => void store.dueSelectionLiveness(10)],
])('B797: %s идёт от очереди сверки, а пул читает по id', (_name, run) => {
  const plans = livenessPlans(run);
  expect(plans).toHaveLength(1);
  expect(plans[0]![0]).toMatch(/^SCAN q\b/u);
  expect(plans[0]![1]).toMatch(/^SEARCH i .*\(id=\?\)$/u);
  expect(plans[0]!.join('\n')).not.toMatch(/SCAN i\b/u);
});
