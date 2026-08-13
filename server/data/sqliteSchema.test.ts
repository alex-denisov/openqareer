import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATION_12, MIGRATION_14 } from './sqliteSchema';

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
});
