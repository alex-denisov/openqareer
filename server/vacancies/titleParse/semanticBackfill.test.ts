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

    expect(report).toMatchObject({
      scanned: 3,
      poolRowsScanned: 4,
      backfilled: 3,
      newKeys: 2,
    });
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
    expect([first.poolRowsScanned, second.poolRowsScanned, third.poolRowsScanned]).toEqual([
      10, 10, 5,
    ]);
    expect(third.passFinished).toBe(true);
    expect(again.backfilled).toBe(0);
    expect(database.prepare('SELECT count(DISTINCT id) AS n FROM vacancy_semantic').get()).toEqual({
      n: 25,
    });
  });

  it('свежий экземпляр после рестарта пропускает готовые окна и завершает хвост', () => {
    const database = poolDatabase();
    for (let index = 0; index < 25; index += 1)
      addVacancy(database, `v${String(index).padStart(2, '0')}`, 'Software Engineer');
    const beforeRestart = new SemanticBackfill(database);
    beforeRestart.step(10);
    beforeRestart.step(10);

    const afterRestart = new SemanticBackfill(database);
    const first = afterRestart.step(10);
    const second = afterRestart.step(10);
    const final = afterRestart.step(10);

    expect([first.backfilled, second.backfilled, final.backfilled]).toEqual([0, 0, 5]);
    expect([first.poolRowsScanned, second.poolRowsScanned, final.poolRowsScanned]).toEqual([
      10, 10, 5,
    ]);
    expect(final.passFinished).toBe(true);
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

  it('ищет устаревшие строки чтением, а удаляет только по списку — без JOIN под блокировкой записи (B303)', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Software Engineer');
    const backfill = new SemanticBackfill(database);
    backfill.step(100);
    database.prepare('UPDATE vacancy_pool_index SET expired = 1 WHERE id = ?').run('v1');
    const statements: string[] = [];
    const prepare = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      statements.push(sql);
      return prepare(sql);
    }) as typeof database.prepare;

    expect(backfill.step(100).pruned).toBe(1);

    const deletes = statements.filter((sql) => /^\s*DELETE/i.test(sql));
    expect(deletes.length).toBeGreaterThan(0);
    for (const sql of deletes) expect(sql).not.toMatch(/JOIN|SELECT/i);
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

  it('переразбирает названия старой версии словаря и пересобирает их строки индекса', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Chief Technology Officer');
    const backfill = new SemanticBackfill(database);
    database
      .prepare(
        `INSERT INTO title_parse (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
         VALUES ('chief technology officer', 'Chief Technology Officer', '["other"]', 4, NULL, 'rules', NULL, 1, 0, 0)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
         VALUES ('v1', 'other', 4, 'chief technology officer', 1000, 1)`,
      )
      .run();

    const report = backfill.step(100);

    expect(report.relabeled).toBe(1);
    expect(semanticRows(database).map((row) => row.function_code)).toEqual(['eng-mgmt']);
  });

  it('точное название из онтологии перебивает разбор модели (26.10: Software Development Manager как Head)', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Software Development Manager');
    addVacancy(database, 'v2', 'Senior Manager, Renewals');
    const backfill = new SemanticBackfill(database);
    const insert = database.prepare(
      `INSERT INTO title_parse (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
       VALUES (?, ?, ?, 2, NULL, 'model', 'gemini', 3, 0, 0)`,
    );
    insert.run('software development manager', 'Software Development Manager', '["eng-mgmt"]');
    insert.run('senior manager, renewals', 'Senior Manager, Renewals', '["sales"]');
    database
      .prepare(
        `INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
         VALUES ('v1', 'eng-mgmt', 2, 'software development manager', 1000, 1),
                ('v2', 'sales', 2, 'senior manager, renewals', 1000, 1)`,
      )
      .run();

    const first = backfill.step(100);
    backfill.step(100);

    expect(first.ontologyCorrected).toBe(2);
    const rows = semanticRows(database);
    expect(rows.find((row) => row.id === 'v1')).toMatchObject({
      function_code: 'eng-mgmt',
      level_rank: 1,
    });
    // CPO 26.10: Senior Manager — lead; функции модели остаются.
    expect(rows.find((row) => row.id === 'v2')).toMatchObject({
      function_code: 'sales',
      level_rank: 1,
    });
  });

  it('Senior Manager с маркером Head остаётся Head, функции модели не меняются', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Senior Manager, Head of Payments');
    addVacancy(database, 'v2', 'Director of Engineering');
    const backfill = new SemanticBackfill(database);
    const insert = database.prepare(
      `INSERT INTO title_parse (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
       VALUES (?, ?, ?, 2, NULL, 'model', 'gemini', 3, 0, 0)`,
    );
    insert.run(
      'senior manager, head of payments',
      'Senior Manager, Head of Payments',
      '["finance"]',
    );
    insert.run('director of engineering', 'Director of Engineering', '["eng-mgmt"]');

    expect(backfill.step(100).ontologyCorrected).toBe(0);
  });

  it('Senior Engineering Manager и «Руководитель группы» от модели переписываются в lead', () => {
    const database = poolDatabase();
    addVacancy(database, 'v1', 'Senior Engineering Manager');
    addVacancy(database, 'v2', 'Head of 1C development / Руководитель группы разработки систем 1С');
    const backfill = new SemanticBackfill(database);
    const insert = database.prepare(
      `INSERT INTO title_parse (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
       VALUES (?, ?, ?, 2, NULL, 'model', 'gemini', 3, 0, 0)`,
    );
    insert.run('senior engineering manager', 'Senior Engineering Manager', '["eng-mgmt"]');
    insert.run(
      'head of 1c development / руководитель группы разработки систем 1с',
      'Head of 1C development / Руководитель группы разработки систем 1С',
      '["eng-mgmt"]',
    );
    database
      .prepare(
        `INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
         VALUES ('v1', 'eng-mgmt', 2, 'senior engineering manager', 1000, 1),
                ('v2', 'eng-mgmt', 2, 'head of 1c development / руководитель группы разработки систем 1с', 1000, 1)`,
      )
      .run();

    backfill.step(100);
    backfill.step(100);

    const rows = semanticRows(database);
    expect(rows.find((row) => row.id === 'v1')).toMatchObject({ level_rank: 1 });
    expect(rows.find((row) => row.id === 'v2')).toMatchObject({ level_rank: 1 });
  });
});
