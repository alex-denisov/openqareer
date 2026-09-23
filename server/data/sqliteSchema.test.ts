import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_4,
  MIGRATION_12,
  MIGRATION_14,
  MIGRATION_15,
  MIGRATION_21,
  MIGRATION_26,
  MIGRATION_32,
  MIGRATION_33,
} from './sqliteSchema';
import { applyMigrations } from './store/applyMigrations';

describe('vacancy source schema migration', () => {
  it('preserves existing hh subscriptions, observations and health', () => {
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    database.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;
      INSERT INTO candidates (id) VALUES ('candidate-1');
      ${MIGRATION_12}
      INSERT INTO vacancy_subscriptions
        (id, candidate_id, source, query_cipher, cadence_minutes, status,
         next_run_at, created_at, updated_at)
      VALUES
        ('subscription-1', 'candidate-1', 'hh', 'sealed-query', 360, 'active',
         '2026-08-13T12:00:00.000Z', '2026-08-13T12:00:00.000Z',
         '2026-08-13T12:00:00.000Z');
      INSERT INTO vacancies
        (id, source, external_id, canonical_url, first_seen_at, last_seen_at,
         latest_version)
      VALUES
        ('vacancy-1', 'hh', '123', 'https://hh.ru/vacancy/123',
         '2026-08-13T12:00:00.000Z', '2026-08-13T12:00:00.000Z', 1);
      INSERT INTO vacancy_versions
        (vacancy_id, version, content_hash, snapshot_json, observed_at)
      VALUES
        ('vacancy-1', 1, 'digest', '{}', '2026-08-13T12:00:00.000Z');
      INSERT INTO vacancy_subscription_items
        (subscription_id, vacancy_id, first_matched_at, last_matched_at)
      VALUES
        ('subscription-1', 'vacancy-1', '2026-08-13T12:00:00.000Z',
         '2026-08-13T12:00:00.000Z');
      INSERT INTO vacancy_source_health
        (source, status, last_attempt_at, consecutive_failures)
      VALUES ('hh', 'degraded', '2026-08-13T12:00:00.000Z', 1);
    `);

    database.exec(MIGRATION_14);

    expect(
      database.prepare('SELECT source FROM vacancy_subscriptions').get(),
    ).toEqual({ source: 'hh' });
    expect(database.prepare('SELECT COUNT(*) AS count FROM vacancy_versions').get()).toEqual({
      count: 1,
    });
    expect(
      database.prepare('SELECT status FROM vacancy_source_health').get(),
    ).toEqual({ status: 'degraded' });
    expect(() =>
      database
        .prepare(
          `INSERT INTO vacancy_subscriptions
            (id, candidate_id, source, query_cipher, cadence_minutes, status,
             next_run_at, created_at, updated_at)
           VALUES (?, ?, 'arbeitnow', ?, 360, 'active', ?, ?, ?)`,
        )
        .run(
          'subscription-2',
          'candidate-1',
          'sealed-query-2',
          '2026-08-13T12:00:00.000Z',
          '2026-08-13T12:00:00.000Z',
          '2026-08-13T12:00:00.000Z',
        ),
    ).not.toThrow();
    database.close();
  });

  it('pauses saved Arbeitnow searches and removes stale source data on replacement', () => {
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    database.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;
      INSERT INTO candidates (id) VALUES ('candidate-1');
      ${MIGRATION_12}
      ${MIGRATION_14}
      INSERT INTO vacancy_subscriptions
        (id, candidate_id, source, query_cipher, cadence_minutes, status,
         next_run_at, last_attempt_at, last_success_at, source_found,
         created_at, updated_at)
      VALUES
        ('subscription-1', 'candidate-1', 'arbeitnow', 'sealed-query', 360,
         'active', '2026-08-13T18:00:00.000Z', '2026-08-13T12:00:00.000Z',
         '2026-08-13T12:00:00.000Z', 1, '2026-08-13T12:00:00.000Z',
         '2026-08-13T12:00:00.000Z');
      INSERT INTO vacancies
        (id, source, external_id, canonical_url, first_seen_at, last_seen_at,
         latest_version)
      VALUES
        ('vacancy-1', 'arbeitnow', 'old-1', 'https://www.arbeitnow.com/jobs/old-1',
         '2026-08-13T12:00:00.000Z', '2026-08-13T12:00:00.000Z', 1);
      INSERT INTO vacancy_versions
        (vacancy_id, version, content_hash, snapshot_json, observed_at)
      VALUES
        ('vacancy-1', 1, 'digest', '{}', '2026-08-13T12:00:00.000Z');
      INSERT INTO vacancy_subscription_items
        (subscription_id, vacancy_id, first_matched_at, last_matched_at)
      VALUES
        ('subscription-1', 'vacancy-1', '2026-08-13T12:00:00.000Z',
         '2026-08-13T12:00:00.000Z');
      INSERT INTO vacancy_source_health
        (source, status, last_attempt_at, last_success_at, consecutive_failures)
      VALUES
        ('arbeitnow', 'healthy', '2026-08-13T12:00:00.000Z',
         '2026-08-13T12:00:00.000Z', 0);
      ${MIGRATION_15}
    `);

    expect(
      database.prepare(
        `SELECT source, status, last_attempt_at, last_success_at,
                last_error_code, source_found
         FROM vacancy_subscriptions`,
      ).get(),
    ).toEqual({
      source: 'remotive',
      status: 'paused',
      last_attempt_at: null,
      last_success_at: null,
      last_error_code: 'source_replaced_review_required',
      source_found: null,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM vacancies').get()).toEqual({
      count: 0,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM vacancy_versions').get()).toEqual({
      count: 0,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM vacancy_source_health').get()).toEqual({
      count: 0,
    });
    database.close();
  });
});

describe('oauth table cleanup migration', () => {
  /**
   * B163 slice 3 — the owner's decision is that the concept is gone, not that
   * it is created and then dropped again. A fresh database must never hold the
   * table, not even for the length of one migration.
   */
  it('never creates an oauth table on the way to a fresh database', () => {
    const created: string[] = [];
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    applyMigrations(database, (op) => {
      op();
      created.push(
        ...(
          database
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'oauth_%'")
            .all() as Array<{ name: string }>
        ).map((row) => row.name),
      );
    });
    database.close();

    expect(created).toEqual([]);
  });

  it('leaves no oauth_% tables in a freshly migrated database', () => {
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    applyMigrations(database, (op) => op());

    const oauthTables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'oauth_%'")
      .all();
    expect(oauthTables).toEqual([]);
    database.close();
  });

  it('drops oauth_% tables that existed before MIGRATION_21', () => {
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    // The legacy shape lives here, in the test that proves it is removed — the
    // shipped migrations no longer carry it (B163).
    database.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE oauth_authorizations (
        state_digest TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'hh')),
        code_verifier_cipher TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE oauth_connections (
        candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
        platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'hh')),
        connection_cipher TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (candidate_id, platform)
      ) STRICT;
    `);

    const tablesBefore = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'oauth_%'")
      .all();
    expect(tablesBefore.length).toBeGreaterThan(0);

    database.exec(MIGRATION_21);

    const tablesAfter = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'oauth_%'")
      .all();
    expect(tablesAfter).toEqual([]);
    database.close();
  });
});

describe('dead work-preferences assessment removal (B187)', () => {
  it('drops stored work-preferences-v1 rows and keeps the product case intact', () => {
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    database.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;
      INSERT INTO candidates (id) VALUES ('candidate-1');
      ${MIGRATION_4}
      INSERT INTO assessments
        (candidate_id, assessment_id, submission_cipher, result_cipher,
         completed_at, updated_at)
      VALUES
        ('candidate-1', 'work-preferences-v1', 'sealed-legacy-submission',
         'sealed-legacy-result', '2026-08-01T10:00:00.000Z',
         '2026-08-01T10:00:00.000Z'),
        ('candidate-1', 'product-case-v1', 'sealed-case-submission',
         'sealed-case-result', '2026-08-02T10:00:00.000Z',
         '2026-08-02T11:00:00.000Z');
    `);

    database.exec(MIGRATION_26);

    const rows = database
      .prepare('SELECT * FROM assessments ORDER BY assessment_id')
      .all() as Array<Record<string, string>>;
    expect(rows).toEqual([
      {
        candidate_id: 'candidate-1',
        assessment_id: 'product-case-v1',
        submission_cipher: 'sealed-case-submission',
        result_cipher: 'sealed-case-result',
        completed_at: '2026-08-02T10:00:00.000Z',
        updated_at: '2026-08-02T11:00:00.000Z',
      },
    ]);
    database.close();
  });

  it('refuses a work-preferences-v1 row in a freshly migrated database', () => {
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    applyMigrations(database, (op) => op());
    database.exec(
      "INSERT INTO candidates (id, token_hash, data_class, locale, created_at, updated_at)" +
        " VALUES ('candidate-1', 'hash-1', 'synthetic', 'ru-RU'," +
        " '2026-09-03T10:00:00.000Z', '2026-09-03T10:00:00.000Z')",
    );

    expect(() =>
      database.exec(
        "INSERT INTO assessments (candidate_id, assessment_id, submission_cipher," +
          " result_cipher, completed_at, updated_at) VALUES ('candidate-1'," +
          " 'work-preferences-v1', 'sealed', 'sealed', '2026-09-03T10:00:00.000Z'," +
          " '2026-09-03T10:00:00.000Z')",
      ),
    ).toThrow(/CHECK constraint failed/u);

    database.exec(
      "INSERT INTO assessments (candidate_id, assessment_id, submission_cipher," +
        " result_cipher, completed_at, updated_at) VALUES ('candidate-1'," +
        " 'product-case-v1', 'sealed', 'sealed', '2026-09-03T10:00:00.000Z'," +
        " '2026-09-03T10:00:00.000Z')",
    );
    expect(
      database.prepare('SELECT COUNT(*) AS total FROM assessments').get(),
    ).toEqual({ total: 1 });
    database.close();
  });
});

describe('candidate media table migration (B265 slice 2)', () => {
  it('creates candidate_media idempotently and only adds the expected columns', () => {
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');

    expect(() => {
      database.exec(MIGRATION_32);
      database.exec(MIGRATION_32);
    }).not.toThrow();

    const columns = (
      database.prepare('PRAGMA table_info(candidate_media)').all() as Array<{
        name: string;
      }>
    ).map((column) => column.name);
    expect(columns.sort()).toEqual(
      [
        'candidate_id',
        'media_id',
        'kind',
        'mime',
        'bytes_cipher',
        'byte_length',
        'created_at',
      ].sort(),
    );
    database.close();
  });

  it('is not an ALTER TABLE: applying it never touches an existing table\'s rows', () => {
    // Owner rule (B230): the prod DB's 20s health window does not survive an
    // ALTER TABLE. MIGRATION_32 must be a bare CREATE TABLE IF NOT EXISTS.
    expect(MIGRATION_32).not.toMatch(/ALTER TABLE/iu);
    expect(MIGRATION_32).toMatch(/CREATE TABLE IF NOT EXISTS candidate_media/u);
  });
});

describe('application tracker schema migration (B251 slice 1)', () => {
  const TABLES = [
    'applications',
    'application_events',
    'application_materials',
    'application_interviews',
    'application_offers',
    'vacancy_skips',
    'candidate_visits',
    'candidate_outreach',
  ];

  function freshDatabase(): DatabaseSync {
    const database = new DatabaseSync(':memory:', {
      enableForeignKeyConstraints: true,
    });
    database.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;');
    return database;
  }

  it('creates all eight tables idempotently', () => {
    const database = freshDatabase();

    expect(() => {
      database.exec(MIGRATION_33);
      database.exec(MIGRATION_33);
    }).not.toThrow();

    for (const table of TABLES) {
      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table),
      ).toEqual({ name: table });
    }
    database.close();
  });

  it('is only CREATE TABLE/INDEX IF NOT EXISTS and never touches vacancy_applications', () => {
    // Owner rule (B230): the prod DB's 20s health window does not survive an
    // ALTER TABLE, and the old facade table stays untouched (architecture.md §5).
    expect(MIGRATION_33).not.toMatch(/ALTER TABLE/iu);
    expect(MIGRATION_33).not.toMatch(/vacancy_applications/iu);
    const statements = MIGRATION_33.split(';').map((s) => s.trim()).filter(Boolean);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE (TABLE|(UNIQUE )?INDEX) IF NOT EXISTS/iu);
    }
  });

  it('rejects an application stage outside the seven known stages', () => {
    const database = freshDatabase();
    database.exec(MIGRATION_33);
    database
      .prepare("INSERT INTO candidates (id) VALUES ('candidate-1')")
      .run();
    expect(() =>
      database
        .prepare(
          `INSERT INTO applications
            (id, candidate_id, stage, stage_changed_at, created_at, updated_at)
           VALUES ('app-1', 'candidate-1', 'bogus', 'now', 'now', 'now')`,
        )
        .run(),
    ).toThrow();
    database.close();
  });

  it('enforces one row per candidate + cluster only when cluster_id is set', () => {
    const database = freshDatabase();
    database.exec(MIGRATION_33);
    database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
    const insertApplication = (id: string, clusterId: string | null) =>
      database
        .prepare(
          `INSERT INTO applications
            (id, candidate_id, cluster_id, stage, stage_changed_at, created_at, updated_at)
           VALUES (?, 'candidate-1', ?, 'saved', 'now', 'now', 'now')`,
        )
        .run(id, clusterId);

    insertApplication('app-1', 'cluster-1');
    expect(() => insertApplication('app-2', 'cluster-1')).toThrow();
    // Manual cards without a pool cluster never collide.
    expect(() => insertApplication('app-3', null)).not.toThrow();
    expect(() => insertApplication('app-4', null)).not.toThrow();
    database.close();
  });

  it('rejects a vacancy skip reason outside the eight B248 terms', () => {
    const database = freshDatabase();
    database.exec(MIGRATION_33);
    database.prepare("INSERT INTO candidates (id) VALUES ('candidate-1')").run();
    expect(() =>
      database
        .prepare(
          `INSERT INTO vacancy_skips (candidate_id, cluster_id, reason_id, origin, created_at)
           VALUES ('candidate-1', 'cluster-1', 'not-a-reason', 'vacancy_card', 'now')`,
        )
        .run(),
    ).toThrow();
    database.close();
  });
});
