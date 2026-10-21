import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureAdminAccessSchema } from './adminAccessSchema';

describe('admin access migration', () => {
  it('adds partner metadata without changing existing admin rows or rebuilding users', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations VALUES (40, 'before');
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('candidate', 'admin')),
        candidate_id TEXT,
        CHECK ((role = 'candidate' AND candidate_id IS NOT NULL) OR
          (role = 'admin' AND candidate_id IS NULL))
      ) STRICT;
      INSERT INTO users (id, role, candidate_id) VALUES ('admin-1', 'admin', NULL);
    `);

    ensureAdminAccessSchema(database);
    ensureAdminAccessSchema(database);

    const existingAdmin = database
      .prepare('SELECT id, role, candidate_id FROM users WHERE id = ?')
      .get('admin-1');
    const columns = database
      .prepare('PRAGMA table_info(users)')
      .all() as Array<{ name: string }>;
    const userTable = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get() as { sql: string };

    expect(existingAdmin).toEqual({ id: 'admin-1', role: 'admin', candidate_id: null });
    expect(columns.map((column) => column.name)).toContain('role_override');
    expect(columns.map((column) => column.name)).toContain('admin_permissions_json');
    expect(userTable.sql).toContain("CHECK (role IN ('candidate', 'admin'))");
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toEqual({
      version: 40,
    });
    database.close();
  });
});
