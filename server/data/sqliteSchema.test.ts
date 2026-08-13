import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_12, MIGRATION_14, MIGRATION_15 } from './sqliteSchema';

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
