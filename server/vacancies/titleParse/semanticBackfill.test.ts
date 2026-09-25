import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_23, VACANCY_POOL_INDEX_TABLE } from '../../data/sqliteSchema';
import { SemanticBackfill } from './semanticBackfill';

function poolDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(MIGRATION_23);
  database.exec(VACANCY_POOL_INDEX_TABLE);
  return database;
}

function addVacancy(
  database: DatabaseSync,
  id: string,
  title: string,
  options: { expired?: boolean; publishedMs?: number } = {},
): void {
  database
    .prepare(
      'INSERT INTO vacancy_pool (id, source_id, published_at, stored_at, payload) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, 'src-test', '2026-09-25', '2026-09-25', JSON.stringify({ id, title }));
  database
    .prepare(
      `INSERT INTO vacancy_pool_index (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired)
       VALUES (?, 'src-test', ?, 0, 1, 1, 'https://example.test', ?, ?)`,
    )
    .run(id, options.publishedMs ?? 1_000, title.toLowerCase(), options.expired ? 1 : 0);
}

function semanticRows(database: DatabaseSync) {
  return database
    .prepare(
      'SELECT id, function_code, level_rank, title_key FROM vacancy_semantic ORDER BY id, function_code',
    )
    .all() as { id: string; function_code: string; level_rank: number | null; title_key: string }[];
}

describe('SemanticBackfill (B267 S2)', () => {
  it('разбирает живые записи пула правилами и пишет кеш названий', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Chief Technology Officer');
    addVacancy(database, 'v2', 'VP of Channel Sales - GFI Software');
    addVacancy(database, 'v3', 'Chief Technology Officer (m/w/d)');
    addVacancy(database, 'gone', 'Accountant', { expired: true });
    const backfill = new SemanticBackfill(database);

    const report = backfill.step(100);

    expect(report).toMatchObject({ scanned: 3, backfilled: 3, newKeys: 2 });
    const rows = semanticRows(database);
    expect(rows.map((row) => row.id)).not.toContain('gone');
    expect(rows.find((row) => row.id === 'v2')?.function_code).toBe('sales');
    expect(rows.find((row) => row.id === 'v1')?.level_rank).toBe(4);
    expect(database.prepare('SELECT count(*) AS n FROM title_parse').get()).toEqual({ n: 2 });
  });

  it('помечает нераспознанное название кодом other, чтобы не разбирать его по кругу', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Zzqx Wibble');
    const backfill = new SemanticBackfill(database);

    backfill.step(100);

    expect(semanticRows(database)).toEqual([
      expect.objectContaining({ id: 'v1', function_code: 'other' }),
    ]);
  });

  it('идёт порциями по курсору и повторный проход ничего не дублирует', () => {
    const database = poolDatabase();
    for (let index = 0; index < 25; index += 1)
      addVacancy(database, `v${String(index).padStart(2, '0')}`, 'Software Engineer');
    const backfill = new SemanticBackfill(database);

    const first = backfill.step(10);
    const second = backfill.step(10);
    const third = backfill.step(10);
    const again = backfill.step(10);

    expect([first.backfilled, second.backfilled, third.backfilled]).toEqual([10, 10, 5]);
    expect(third.passFinished).toBe(true);
    expect(again.backfilled).toBe(0);
    expect(database.prepare('SELECT count(DISTINCT id) AS n FROM vacancy_semantic').get()).toEqual({
      n: 25,
    });
  });

  it('берёт разбор из кеша, если название уже разобрано', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Wibble Specialist');
    const backfill = new SemanticBackfill(database);
    database
      .prepare(
        `INSERT INTO title_parse (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
         VALUES ('wibble specialist', 'Wibble Specialist', '["data"]', 0, NULL, 'model', 'm', 1, 0, 0)`,
      )
      .run();

    backfill.step(100);

    expect(semanticRows(database)).toEqual([
      expect.objectContaining({ id: 'v1', function_code: 'data', level_rank: 0 }),
    ]);
  });

  it('в конце прохода удаляет строки вакансий, которых больше нет в живом пуле', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Software Engineer');
    addVacancy(database, 'v2', 'Software Engineer');
    const backfill = new SemanticBackfill(database);
    backfill.step(100);
    database.prepare('UPDATE vacancy_pool_index SET expired = 1 WHERE id = ?').run('v2');

    const report = backfill.step(100);

    expect(report.pruned).toBe(1);
    expect(semanticRows(database).map((row) => row.id)).toEqual(['v1']);
  });

  it('укладывает порцию из 5 000 записей в бюджет короткой транзакции', () => {
    const database = poolDatabase();
    for (let index = 0; index < 5_000; index += 1) {
      addVacancy(
        database,
        `v${String(index).padStart(5, '0')}`,
        `Senior Engineer ${index % 400} Platform`,
      );
    }
    const backfill = new SemanticBackfill(database);

    const startedAt = performance.now();
    const report = backfill.step(1_000);
    const elapsed = performance.now() - startedAt;

    expect(report.backfilled).toBe(1_000);
    expect(elapsed).toBeLessThan(1_000);
  });
});
