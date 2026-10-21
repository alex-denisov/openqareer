import type { DatabaseSync } from 'node:sqlite';

export function ensureAdminAccessSchema(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    addAdminAccessColumns(database);
    database.exec(`
      CREATE TABLE IF NOT EXISTS career_partner_assignments (
        partner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        candidate_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (partner_user_id, candidate_user_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS career_partner_assignments_candidate
        ON career_partner_assignments(candidate_user_id);
    `);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function addAdminAccessColumns(database: DatabaseSync): void {
  const columns = new Set(
    (database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has('role_override')) {
    database.exec('ALTER TABLE users ADD COLUMN role_override TEXT');
  }
  if (!columns.has('admin_permissions_json')) {
    database.exec('ALTER TABLE users ADD COLUMN admin_permissions_json TEXT');
  }
}
