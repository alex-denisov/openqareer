import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { computeMvpBaseline } from './mvpBaseline.mjs';

function createTestDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');

  db.exec(`
    CREATE TABLE candidates (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      data_class TEXT NOT NULL CHECK (data_class IN ('synthetic', 'personal')),
      locale TEXT NOT NULL CHECK (locale IN ('ru-RU', 'en-US')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('candidate', 'admin')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      candidate_id TEXT UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
      is_test INTEGER NOT NULL CHECK (is_test IN (0, 1)),
      email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE vacancy_subscriptions (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE vacancies (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      latest_version INTEGER NOT NULL CHECK (latest_version > 0)
    ) STRICT;

    CREATE TABLE vacancy_subscription_items (
      subscription_id TEXT NOT NULL REFERENCES vacancy_subscriptions(id) ON DELETE CASCADE,
      vacancy_id TEXT NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
      first_matched_at TEXT NOT NULL,
      last_matched_at TEXT NOT NULL,
      PRIMARY KEY (subscription_id, vacancy_id)
    ) STRICT;

    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      cluster_id TEXT,
      stage TEXT NOT NULL CHECK (stage IN (
        'saved', 'applied', 'responded', 'interview', 'offer', 'rejected', 'archived'
      )),
      closed_reason TEXT,
      process_profile TEXT NOT NULL DEFAULT 'standard',
      vacancy_cipher TEXT,
      notes_cipher TEXT,
      follow_up_due_at TEXT,
      stage_changed_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);

  return db;
}

function seedBaselineData(db: DatabaseSync): void {
  // 5 candidates + 1 test account + 1 admin
  const candidates = [
    { id: 'cand-1', created: '2026-09-01T10:00:00.000Z' },
    { id: 'cand-2', created: '2026-09-02T10:00:00.000Z' },
    { id: 'cand-3', created: '2026-09-05T10:00:00.000Z' },
    { id: 'cand-4', created: '2026-09-10T10:00:00.000Z' },
    { id: 'cand-5', created: '2026-09-25T10:00:00.000Z' },
    { id: 'cand-test', created: '2026-09-03T10:00:00.000Z' },
  ];

  for (const c of candidates) {
    db.prepare(`
      INSERT INTO candidates (id, token_hash, data_class, locale, created_at, updated_at)
      VALUES (?, ?, 'personal', 'ru-RU', ?, ?)
    `).run(c.id, `tok-${c.id}`, c.created, c.created);
  }

  const users = [
    { id: 'usr-1', username: 'alexey@example.com', role: 'candidate', candId: 'cand-1', isTest: 0, email: 'alexey@example.com', created: '2026-09-01T10:00:00.000Z' },
    { id: 'usr-2', username: 'boris@example.com', role: 'candidate', candId: 'cand-2', isTest: 0, email: 'boris@example.com', created: '2026-09-02T10:00:00.000Z' },
    { id: 'usr-3', username: 'clara@example.com', role: 'candidate', candId: 'cand-3', isTest: 0, email: 'clara@example.com', created: '2026-09-05T10:00:00.000Z' },
    { id: 'usr-4', username: 'dmitry@example.com', role: 'candidate', candId: 'cand-4', isTest: 0, email: 'dmitry@example.com', created: '2026-09-10T10:00:00.000Z' },
    { id: 'usr-5', username: 'elena@example.com', role: 'candidate', candId: 'cand-5', isTest: 0, email: 'elena@example.com', created: '2026-09-25T10:00:00.000Z' },
    { id: 'usr-test', username: 'tester.test', role: 'candidate', candId: 'cand-test', isTest: 1, email: 'tester@test.test', created: '2026-09-03T10:00:00.000Z' },
    { id: 'usr-admin', username: 'admin@example.com', role: 'admin', candId: null, isTest: 0, email: 'admin@example.com', created: '2026-09-01T08:00:00.000Z' },
  ];

  for (const u of users) {
    db.prepare(`
      INSERT INTO users (id, username, role, password_salt, password_hash, candidate_id, is_test, email, created_at, updated_at)
      VALUES (?, ?, ?, 'salt', 'hash', ?, ?, ?, ?, ?)
    `).run(u.id, u.username, u.role, u.candId, u.isTest, u.email, u.created, u.created);
  }

  // Vacancy & Subscriptions:
  // cand-1: subscription with item (has vacancies)
  // cand-2: subscription without items (empty)
  // cand-3: subscription with item (has vacancies)
  // cand-5: subscription with item (has vacancies)
  db.prepare(`
    INSERT INTO vacancies (id, source, external_id, canonical_url, first_seen_at, last_seen_at, latest_version)
    VALUES ('vac-1', 'hh', 'hh-1', 'https://hh.ru/1', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z', 1)
  `).run();

  const subs = [
    { id: 'sub-1', candId: 'cand-1' },
    { id: 'sub-2', candId: 'cand-2' },
    { id: 'sub-3', candId: 'cand-3' },
    { id: 'sub-5', candId: 'cand-5' },
  ];
  for (const s of subs) {
    db.prepare(`
      INSERT INTO vacancy_subscriptions (id, candidate_id, source, status, created_at, updated_at)
      VALUES (?, ?, 'hh', 'active', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z')
    `).run(s.id, s.candId);
  }

  // Items in subscriptions (sub-1, sub-3, sub-5)
  for (const subId of ['sub-1', 'sub-3', 'sub-5']) {
    db.prepare(`
      INSERT INTO vacancy_subscription_items (subscription_id, vacancy_id, first_matched_at, last_matched_at)
      VALUES (?, 'vac-1', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z')
    `).run(subId);
  }

  // Applications:
  // cand-1: 12h after registration (2026-09-01T22:00:00.000Z)
  // cand-2: 24h after registration (2026-09-03T10:00:00.000Z)
  // cand-3: 48h after registration (2026-09-07T10:00:00.000Z)
  // cand-5: 6h after registration (2026-09-25T16:00:00.000Z)
  // cand-4: no application
  const apps = [
    { id: 'app-1', candId: 'cand-1', created: '2026-09-01T22:00:00.000Z' },
    { id: 'app-2', candId: 'cand-2', created: '2026-09-03T10:00:00.000Z' },
    { id: 'app-3', candId: 'cand-3', created: '2026-09-07T10:00:00.000Z' },
    { id: 'app-5', candId: 'cand-5', created: '2026-09-25T16:00:00.000Z' },
  ];
  for (const a of apps) {
    db.prepare(`
      INSERT INTO applications (id, candidate_id, stage, stage_changed_at, created_at, updated_at)
      VALUES (?, ?, 'applied', ?, ?, ?)
    `).run(a.id, a.candId, a.created, a.created, a.created);
  }

  // Sessions for D7 return (capturedAt is 2026-09-30T12:00:00.000Z):
  // cand-1 (reg: 2026-09-01): day 8 session -> in [7d, 14d]
  // cand-2 (reg: 2026-09-02): no session in [7d, 14d]
  // cand-3 (reg: 2026-09-05): day 10 session -> in [7d, 14d]
  // cand-4 (reg: 2026-09-10): no session in [7d, 14d]
  // cand-5 (reg: 2026-09-25): registered < 7 days before capturedAt -> excluded from D7 denominator
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
    VALUES
      ('tok-1', 'usr-1', '2026-10-01T00:00:00.000Z', '2026-09-09T10:00:00.000Z', '2026-09-09T11:00:00.000Z'),
      ('tok-3', 'usr-3', '2026-10-01T00:00:00.000Z', '2026-09-15T10:00:00.000Z', '2026-09-15T10:30:00.000Z')
  `).run();
}

describe('mvpBaseline calculation module', () => {
  const capturedAt = '2026-09-30T12:00:00.000Z';

  it('calculates activation, time to first application, and D7 retention with known test data', () => {
    const db = createTestDatabase();
    seedBaselineData(db);

    const result = computeMvpBaseline(db, {
      since: '2026-09-01',
      excludeTest: true,
      capturedAt,
    });

    // 1. Activation: 3 candidates with subscription items out of 5 total registered = 0.6
    expect(result.activation.value).toBe(0.6);
    expect(result.activation.numerator).toBe(3);
    expect(result.activation.denominator).toBe(5);
    expect(result.activation.sampleSize).toBe(5);
    expect(result.activation.source).toContain('vacancy_subscriptions');

    // 2. Time to first application: [6h, 12h, 24h, 48h]
    // Median of 4 elements: (12 + 24) / 2 = 18.0
    // P75 of 4 elements: 30.0
    expect(result.timeToFirstApplication.value).toBe(18);
    expect(result.timeToFirstApplication.median).toBe(18);
    expect(result.timeToFirstApplication.p75).toBe(30);
    expect(result.timeToFirstApplication.sampleSize).toBe(4);
    expect(result.timeToFirstApplication.withoutApplication).toBe(1);
    expect(result.timeToFirstApplication.source).toContain('applications');

    // 3. D7 retention:
    // Eligible: cand-1, cand-2, cand-3, cand-4 (registered <= 2026-09-23) -> 4 candidates
    // Active in [7d, 14d]: cand-1 and cand-3 -> 2 candidates
    // Value: 2 / 4 = 0.5
    expect(result.d7Retention.value).toBe(0.5);
    expect(result.d7Retention.numerator).toBe(2);
    expect(result.d7Retention.denominator).toBe(4);
    expect(result.d7Retention.sampleSize).toBe(4);
    expect(result.d7Retention.source).toContain('sessions');

    // 4. Top-20 relevance: null with pointer to script
    expect(result.top20Relevance.value).toBeNull();
    expect(result.top20Relevance.source).toBe('scripts/measure-strict-top20.mjs');
  });

  it('respects --exclude-test toggle', () => {
    const db = createTestDatabase();
    seedBaselineData(db);

    const withExclude = computeMvpBaseline(db, {
      since: '2026-09-01',
      excludeTest: true,
      capturedAt,
    });
    const withoutExclude = computeMvpBaseline(db, {
      since: '2026-09-01',
      excludeTest: false,
      capturedAt,
    });

    expect(withExclude.activation.denominator).toBe(5);
    expect(withoutExclude.activation.denominator).toBe(6); // includes tester.test
  });

  it('handles empty database gracefully without throwing exceptions', () => {
    const db = createTestDatabase();

    const result = computeMvpBaseline(db, {
      since: '2026-09-01',
      excludeTest: true,
      capturedAt,
    });

    expect(result.activation.value).toBeNull();
    expect(result.activation.numerator).toBe(0);
    expect(result.activation.denominator).toBe(0);

    expect(result.timeToFirstApplication.value).toBeNull();
    expect(result.timeToFirstApplication.median).toBeNull();
    expect(result.timeToFirstApplication.p75).toBeNull();
    expect(result.timeToFirstApplication.sampleSize).toBe(0);
    expect(result.timeToFirstApplication.withoutApplication).toBe(0);

    expect(result.d7Retention.value).toBeNull();
    expect(result.d7Retention.numerator).toBe(0);
    expect(result.d7Retention.denominator).toBe(0);

    expect(result.top20Relevance.value).toBeNull();
  });

  it('handles missing tables gracefully with honest source explanation', () => {
    const db = new DatabaseSync(':memory:');
    // completely bare database with no tables

    const result = computeMvpBaseline(db, {
      since: '2026-09-01',
      excludeTest: true,
      capturedAt,
    });

    expect(result.activation.value).toBeNull();
    expect(result.activation.source).toMatch(/нет таблицы/u);

    expect(result.timeToFirstApplication.value).toBeNull();
    expect(result.timeToFirstApplication.source).toMatch(/нет таблицы/u);

    expect(result.d7Retention.value).toBeNull();
    expect(result.d7Retention.source).toMatch(/нет таблицы/u);
  });
});
