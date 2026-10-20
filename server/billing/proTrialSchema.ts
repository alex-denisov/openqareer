export const MIGRATION_PRO_TRIAL = `
CREATE TABLE billing_pro_trials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  CHECK (expires_at > started_at)
);
`;
